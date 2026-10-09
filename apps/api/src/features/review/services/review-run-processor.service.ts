import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { Data, Effect, Exit, Result } from "effect";
import type { Logger } from "pino";

import {
	ReviewContextCapacityExceeded,
	ReviewModelResponseError,
} from "../errors/review-model.error.js";
import type { ReviewRunRepository } from "../repositories/review-run.repository.js";
import type {
	FindingJudgment,
	ReviewFindingJudge,
	ReviewInput,
	ReviewInputLoadResult,
	ReviewInputSource,
	ReviewModel,
	ReviewModelResult,
	ReviewTokenUsage,
} from "../types/review-input.types.js";
import type {
	ReviewRunErrorCode,
	RunnableReviewRun,
	StoredFinding,
} from "../types/review-repository.types.js";
import type { ReviewFinding, ReviewWorkQueue } from "../types/review-run.types.js";
import {
	createReviewFindingJudgeBatches,
	type ChunkFindingCandidate,
	type ReviewFindingJudgeBatch,
} from "../utils/review-finding-evidence.util.js";
import { ReviewUsageLedger } from "../utils/review-usage-ledger.util.js";
const REVIEW_STRATEGY_VERSION = "repository-context-v5";
const REVIEW_RUN_TIMEOUT_MS = 30 * 60 * 1_000;
const EMPTY_USAGE: ReviewTokenUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheTokens: 0,
	costUsdMicros: 0,
};
type ReviewStageOutcome = "completed" | "failed" | "ignored";

type AnalysisOutcome =
	| Exclude<ReviewInputLoadResult, { readonly kind: "ready" }>
	| {
			readonly kind: "completed";
			readonly input: ReviewInput;
			readonly findings: readonly StoredFinding[];
	  };

class ReviewProcessingFailure extends Data.TaggedError("ReviewProcessingFailure")<{
	readonly errorCode: ReviewRunErrorCode;
}> {}

export class ReviewRunProcessorService {
	constructor(
		private readonly repository: ReviewRunRepository,
		private readonly inputSource: ReviewInputSource,
		private readonly model: ReviewModel,
		private readonly judge: ReviewFindingJudge,
		private readonly queue: Pick<ReviewWorkQueue, "enqueueReport">,
		private readonly logger: Logger,
	) {}

	async process(reviewRunId: string): Promise<void> {
		const run = this.repository.claimQueuedReviewRun(reviewRunId);
		if (run === null) {
			return;
		}

		const startedAt = performance.now();
		this.logger.info({ modelName: run.model.apiName, reviewRunId }, "review_run.started");

		const ledger = new ReviewUsageLedger(this.repository.readReviewRunUsage(run.id), run.model);
		const analysis = await Effect.runPromise(
			this.analyze(run, ledger).pipe(
				Effect.timeoutOrElse({
					duration: REVIEW_RUN_TIMEOUT_MS,
					orElse: () =>
						Effect.fail(
							new ReviewProcessingFailure({ errorCode: "review_run_timeout" }),
						),
				}),
				Effect.result,
			),
		);
		if (Result.isFailure(analysis)) {
			this.fail(run, analysis.failure.errorCode, ledger, startedAt);
			return;
		}
		const outcome = analysis.success;
		if (outcome.kind === "ignored") {
			this.repository.ignoreReviewRun(reviewRunId, outcome.ignoreReason);
			this.logIgnoredRun(run, outcome.ignoreReason, startedAt);
			return;
		}
		if (outcome.kind === "failed") {
			this.fail(run, outcome.errorCode, ledger, startedAt);
			return;
		}
		await this.complete(run, outcome, ledger, startedAt);
	}

	private analyze(
		run: RunnableReviewRun,
		ledger: ReviewUsageLedger,
	): Effect.Effect<AnalysisOutcome, ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const loaded = yield* this.observeStage(
				run,
				"context_load",
				this.loadInput(run),
				inputStageOutcome,
			);
			if (loaded.kind !== "ready") return loaded;
			const candidates = yield* this.observeStage(
				run,
				"candidate_generation",
				this.generateCandidates(run.model, loaded.input, ledger),
			);
			const findings = yield* this.observeStage(
				run,
				"candidate_judgment",
				this.judgeCandidates(run.model, loaded.input, candidates, ledger),
			);
			return { kind: "completed", input: loaded.input, findings } as const;
		});
	}

	private observeStage<A>(
		run: RunnableReviewRun,
		stage: "context_load" | "candidate_generation" | "candidate_judgment",
		program: Effect.Effect<A, ReviewProcessingFailure>,
		describeOutcome: (value: A) => ReviewStageOutcome = () => "completed",
	): Effect.Effect<A, ReviewProcessingFailure> {
		return Effect.suspend(() => {
			const startedAt = performance.now();
			return program.pipe(
				Effect.onExit((exit) =>
					Effect.sync(() =>
						this.logger.info(
							{
								reviewRunId: run.id,
								stage,
								durationMs: elapsedMilliseconds(startedAt),
								outcome: Exit.isSuccess(exit)
									? describeOutcome(exit.value)
									: "failed",
							},
							"review_run.stage_finished",
						),
					),
				),
			);
		});
	}

	private async complete(
		run: RunnableReviewRun,
		outcome: Extract<AnalysisOutcome, { readonly kind: "completed" }>,
		ledger: ReviewUsageLedger,
		startedAt: number,
	): Promise<void> {
		const durationMs = elapsedMilliseconds(startedAt);
		const reviewReportId = this.repository.completeReviewRun(run.id, {
			reviewUsage: ledger.usage("review") ?? EMPTY_USAGE,
			judgeUsage: ledger.usage("judge") ?? EMPTY_USAGE,
			findings: outcome.findings,
			reviewReportId: randomUUID(),
			reviewStrategyVersion: REVIEW_STRATEGY_VERSION,
			changedLineCount: countChangedLines(outcome.input),
			reviewChunkCount: outcome.input.chunks.length,
			judgeCallCount: ledger.judgeCallCount(),
			processingDurationMs: durationMs,
		});
		await this.queue.enqueueReport(reviewReportId);
		this.logger.info(
			{
				chunkCount: outcome.input.chunks.length,
				durationMs,
				findingCount: outcome.findings.length,
				modelName: run.model.apiName,
				reviewRunId: run.id,
			},
			"review_run.completed",
		);
	}

	private generateCandidates(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		ledger: ReviewUsageLedger,
	): Effect.Effect<readonly ChunkFindingCandidate[], ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const results = yield* Effect.forEach(
				input.chunks,
				(chunk) =>
					this.reviewChunk(model, input, chunk, ledger).pipe(
						Effect.map((result) => ({ chunk, result })),
					),
				{ concurrency: 1 },
			);
			return deduplicateCandidates(
				results.flatMap(({ chunk, result }) =>
					result.findings.map((finding) => ({
						chunk,
						finding,
						investigation: result.investigation,
					})),
				),
			);
		});
	}

	private judgeCandidates(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		candidates: readonly ChunkFindingCandidate[],
		ledger: ReviewUsageLedger,
	): Effect.Effect<readonly StoredFinding[], ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const batches = createReviewFindingJudgeBatches(candidates);
			if (batches === null) {
				return yield* new ReviewProcessingFailure({
					errorCode: "finding_location_invalid",
				});
			}
			const results = yield* Effect.forEach(
				batches,
				(batch) => this.judgeWithinCapacity(model, input, batch, ledger),
				{ concurrency: 1 },
			);
			return results.flat();
		});
	}

	private judgeWithinCapacity(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		batch: ReviewFindingJudgeBatch,
		ledger: ReviewUsageLedger,
	): Effect.Effect<readonly StoredFinding[], ReviewProcessingFailure> {
		return this.judgeBatch(model, input, batch, ledger).pipe(
			Effect.catch((error) => {
				if (
					error.errorCode !== "review_context_capacity_exceeded" ||
					batch.findings.length <= 1
				)
					return Effect.fail(error);
				const halves = splitJudgeBatch(batch);
				return Effect.forEach(
					halves,
					(part) => this.judgeWithinCapacity(model, input, part, ledger),
					{ concurrency: 1 },
				).pipe(Effect.map((results) => results.flat()));
			}),
		);
	}

	private judgeBatch(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		batch: ReviewFindingJudgeBatch,
		ledger: ReviewUsageLedger,
	): Effect.Effect<readonly StoredFinding[], ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const fields = {
				candidateCount: batch.findings.length,
				modelName: model.apiName,
				reviewRunId: input.reviewRunId,
			};
			const result = yield* Effect.tryPromise({
				try: (signal) =>
					this.judge.judge(model, input, batch.input, {
						signal,
						recordUsage: (event) => ledger.record(event),
					}),
				catch: (error) => this.modelFailure(error, "judge", fields),
			});
			const validation = validateJudgments(batch.findings, result.judgments);
			if (validation.kind === "invalid") {
				this.logger.warn(
					{
						...fields,
						judgmentCount: result.judgments.length,
						reason: validation.reason,
					},
					"gemini_judge.invalid_response",
				);
				return yield* new ReviewProcessingFailure({
					errorCode: "gemini_judge_invalid_response",
				});
			}
			return batch.findings.map((finding, index) =>
				toStoredFinding(finding, validation.judgments[index]!),
			);
		});
	}

	private loadInput(
		run: RunnableReviewRun,
	): Effect.Effect<ReviewInputLoadResult, ReviewProcessingFailure> {
		return Effect.tryPromise({
			try: (signal) => this.inputSource.load(run, signal),
			catch: () => new ReviewProcessingFailure({ errorCode: "github_diff_unavailable" }),
		});
	}

	private reviewChunk(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		chunk: ReviewInput["chunks"][number],
		ledger: ReviewUsageLedger,
	): Effect.Effect<ReviewModelResult, ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const result = yield* Effect.tryPromise({
				try: (signal) =>
					this.model.review(model, input, chunk, {
						signal,
						recordUsage: (event) => ledger.record(event),
					}),
				catch: (error) =>
					this.modelFailure(error, "review", {
						chunkIndex: chunk.index,
						modelName: model.apiName,
						reviewRunId: input.reviewRunId,
					}),
			});
			if (!result.findings.every((finding) => isValidFinding(finding, chunk))) {
				return yield* new ReviewProcessingFailure({
					errorCode: "finding_location_invalid",
				});
			}
			return result;
		});
	}

	private modelFailure(
		error: unknown,
		stage: "review" | "judge",
		fields: Readonly<Record<string, string | number>>,
	): ReviewProcessingFailure {
		if (error instanceof ReviewContextCapacityExceeded) {
			return new ReviewProcessingFailure({ errorCode: "review_context_capacity_exceeded" });
		}
		if (!(error instanceof ReviewModelResponseError)) {
			return new ReviewProcessingFailure({
				errorCode:
					stage === "judge" ? "gemini_judge_request_failed" : "gemini_request_failed",
			});
		}
		this.logger.warn({ ...fields, reason: error.issue }, `gemini_${stage}.invalid_response`);
		return new ReviewProcessingFailure({
			errorCode:
				stage === "judge" ? "gemini_judge_invalid_response" : "gemini_invalid_response",
		});
	}

	private logIgnoredRun(run: RunnableReviewRun, reason: string, startedAt: number): void {
		this.logger.info(
			{
				durationMs: elapsedMilliseconds(startedAt),
				modelName: run.model.apiName,
				reason,
				reviewRunId: run.id,
			},
			"review_run.ignored",
		);
	}

	private fail(
		run: RunnableReviewRun,
		errorCode: ReviewRunErrorCode,
		ledger: ReviewUsageLedger,
		startedAt: number,
	): void {
		this.repository.failReviewRun(run.id, errorCode, {
			reviewUsage: ledger.usage("review"),
			judgeUsage: ledger.usage("judge"),
			judgeCallCount: ledger.judgeCallCount(),
			processingDurationMs: elapsedMilliseconds(startedAt),
		});
		this.logger.warn(
			{
				durationMs: elapsedMilliseconds(startedAt),
				errorCode,
				modelName: run.model.apiName,
				reviewRunId: run.id,
			},
			"review_run.failed",
		);
	}
}

type JudgmentValidationReason = "coverage_mismatch" | "invalid_judgment" | "unchanged_severity";
function inputStageOutcome(input: ReviewInputLoadResult): ReviewStageOutcome {
	if (input.kind === "ready") return "completed";
	return input.kind;
}
type JudgmentValidationResult =
	| { readonly kind: "valid"; readonly judgments: readonly FindingJudgment[] }
	| { readonly kind: "invalid"; readonly reason: JudgmentValidationReason };
type IndexedJudgmentValidation =
	| { readonly kind: "valid"; readonly judgment: FindingJudgment }
	| { readonly kind: "invalid"; readonly reason: JudgmentValidationReason };

function validateJudgments(
	findings: readonly ReviewFinding[],
	judgments: readonly { readonly index: number; readonly judgment: FindingJudgment }[],
): JudgmentValidationResult {
	if (judgments.length !== findings.length) {
		return { kind: "invalid", reason: "coverage_mismatch" };
	}

	const byIndex = new Map(judgments.map(({ index, judgment }) => [index, judgment]));
	if (byIndex.size !== findings.length) {
		return { kind: "invalid", reason: "coverage_mismatch" };
	}

	const ordered: FindingJudgment[] = [];
	for (const [index, finding] of findings.entries()) {
		const validation = validateIndexedJudgment(finding, byIndex.get(index));
		if (validation.kind === "invalid") {
			return validation;
		}
		ordered.push(validation.judgment);
	}
	return { kind: "valid", judgments: ordered };
}

function validateIndexedJudgment(
	finding: ReviewFinding,
	judgment: FindingJudgment | undefined,
): IndexedJudgmentValidation {
	if (judgment === undefined) {
		return { kind: "invalid", reason: "coverage_mismatch" };
	}
	if (judgment.rationale.trim().length === 0) {
		return { kind: "invalid", reason: "invalid_judgment" };
	}
	if (judgment.kind === "severity_changed" && judgment.severity === finding.severity) {
		return { kind: "invalid", reason: "unchanged_severity" };
	}
	return { kind: "valid", judgment };
}

function isValidFinding(finding: ReviewFinding, chunk: ReviewInput["chunks"][number]): boolean {
	return (
		hasValidContent(finding) &&
		(chunk.changedLines.get(finding.path)?.has(finding.line) ?? false)
	);
}

function hasValidContent(finding: ReviewFinding): boolean {
	return (
		["critical", "high", "medium", "low"].includes(finding.severity) &&
		finding.path.trim().length > 0 &&
		finding.title.trim().length > 0 &&
		finding.rationale.trim().length > 0
	);
}

function deduplicateCandidates(
	candidates: readonly ChunkFindingCandidate[],
): readonly ChunkFindingCandidate[] {
	const unique = new Map<string, ChunkFindingCandidate>();
	for (const candidate of candidates) {
		const key = `${candidate.finding.path}:${candidate.finding.line}:${candidate.finding.title}`;
		if (!unique.has(key)) {
			unique.set(key, candidate);
		}
	}
	return [...unique.values()];
}

function toStoredFinding(finding: ReviewFinding, judgment: FindingJudgment): StoredFinding {
	return {
		...finding,
		id: randomUUID(),
		judgeVerdict: judgment.kind,
		judgeSeverity: judgment.kind === "severity_changed" ? judgment.severity : null,
		judgeRationale: judgment.rationale,
		includedInReport: judgment.kind !== "rejected",
	};
}

function splitJudgeBatch(batch: ReviewFindingJudgeBatch): readonly ReviewFindingJudgeBatch[] {
	const midpoint = Math.ceil(batch.findings.length / 2);
	return [
		[0, midpoint],
		[midpoint, batch.findings.length],
	].map(([start, end]) => {
		const candidates = batch.input.candidates
			.slice(start, end)
			.map((candidate, index) => ({ ...candidate, index }));
		const evidenceIds = new Set(candidates.map((candidate) => candidate.evidenceId));
		return {
			findings: batch.findings.slice(start, end),
			input: {
				candidates,
				evidence: batch.input.evidence.filter((evidence) => evidenceIds.has(evidence.id)),
			},
		};
	});
}

function countChangedLines(input: ReviewInput): number {
	const linesByPath = new Map<string, Set<number>>();
	for (const chunk of input.chunks) {
		for (const [path, lines] of chunk.changedLines) {
			const combined = linesByPath.get(path) ?? new Set<number>();
			for (const line of lines) {
				combined.add(line);
			}
			linesByPath.set(path, combined);
		}
	}
	return [...linesByPath.values()].reduce((total, lines) => total + lines.size, 0);
}

function elapsedMilliseconds(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}
