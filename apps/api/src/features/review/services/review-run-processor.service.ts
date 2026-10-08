import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { Data, Effect, Result } from "effect";
import type { Logger } from "pino";

import { ReviewModelResponseError } from "../errors/review-model.error.js";
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
const REVIEW_STRATEGY_VERSION = "repository-context-v4";
const EMPTY_USAGE: ReviewTokenUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheTokens: 0,
	costUsdMicros: 0,
};

interface CompletedReview {
	readonly findings: readonly StoredFinding[];
	readonly reviewUsage: ReviewTokenUsage;
	readonly judgeUsage: ReviewTokenUsage;
	readonly judgeCallCount: number;
}

class ReviewProcessingFailure extends Data.TaggedError("ReviewProcessingFailure")<{
	readonly errorCode: ReviewRunErrorCode;
}> {}

interface GeneratedCandidates {
	readonly candidates: readonly ChunkFindingCandidate[];
	readonly usage: ReviewTokenUsage;
}

interface JudgedBatch {
	readonly findings: readonly StoredFinding[];
	readonly usage: ReviewTokenUsage;
}

interface JudgedCandidates extends JudgedBatch {
	readonly callCount: number;
}

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

		const inputResult = await Effect.runPromise(
			this.loadInput(run).pipe(
				Effect.catch((error) =>
					Effect.succeed<ReviewInputLoadResult>({
						kind: "failed",
						errorCode: error.errorCode,
					}),
				),
			),
		);
		if (inputResult.kind === "ignored") {
			this.repository.ignoreReviewRun(reviewRunId, inputResult.ignoreReason);
			this.logIgnoredRun(run, inputResult.ignoreReason, startedAt);
			return;
		}

		if (inputResult.kind === "failed") {
			this.fail(run, inputResult.errorCode, startedAt);
			return;
		}

		const analysis = await Effect.runPromise(
			this.review(run.model, inputResult.input).pipe(Effect.result),
		);
		if (Result.isFailure(analysis)) {
			this.fail(run, analysis.failure.errorCode, startedAt);
			return;
		}
		const reviewResult = analysis.success;

		const durationMs = elapsedMilliseconds(startedAt);
		const reviewReportId = this.repository.completeReviewRun(reviewRunId, {
			reviewUsage: reviewResult.reviewUsage,
			judgeUsage: reviewResult.judgeUsage,
			findings: reviewResult.findings,
			reviewReportId: randomUUID(),
			reviewStrategyVersion: REVIEW_STRATEGY_VERSION,
			changedLineCount: countChangedLines(inputResult.input),
			reviewChunkCount: inputResult.input.chunks.length,
			judgeCallCount: reviewResult.judgeCallCount,
			processingDurationMs: durationMs,
		});

		await this.queue.enqueueReport(reviewReportId);
		this.logger.info(
			{
				chunkCount: inputResult.input.chunks.length,
				durationMs,
				findingCount: reviewResult.findings.length,
				modelName: run.model.apiName,
				reviewRunId,
			},
			"review_run.completed",
		);
	}

	private review(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
	): Effect.Effect<CompletedReview, ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const generated = yield* this.generateCandidates(model, input);
			const judged = yield* this.judgeCandidates(model, input, generated.candidates);
			return {
				findings: judged.findings,
				reviewUsage: roundUsageCost(generated.usage),
				judgeUsage: roundUsageCost(judged.usage),
				judgeCallCount: judged.callCount,
			};
		});
	}

	private generateCandidates(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
	): Effect.Effect<GeneratedCandidates, ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const results = yield* Effect.forEach(
				input.chunks,
				(chunk) =>
					this.reviewChunk(model, input, chunk).pipe(
						Effect.map((result) => ({ chunk, result })),
					),
				{ concurrency: 1 },
			);
			const candidates = results.flatMap(({ chunk, result }) =>
				result.findings.map((finding) => ({
					chunk,
					finding,
					investigation: result.investigation,
				})),
			);
			return {
				candidates: deduplicateCandidates(candidates),
				usage: results.reduce(
					(usage, { result }) => addUsage(usage, result.usage),
					EMPTY_USAGE,
				),
			};
		});
	}

	private judgeCandidates(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		candidates: readonly ChunkFindingCandidate[],
	): Effect.Effect<JudgedCandidates, ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const batches = createReviewFindingJudgeBatches(candidates);
			if (batches === null) {
				return yield* new ReviewProcessingFailure({
					errorCode: "finding_location_invalid",
				});
			}
			const results = yield* Effect.forEach(
				batches,
				(batch) => this.judgeBatch(model, input, batch),
				{ concurrency: 1 },
			);
			return {
				findings: results.flatMap((result) => result.findings),
				usage: results.reduce(
					(usage, result) => addUsage(usage, result.usage),
					EMPTY_USAGE,
				),
				callCount: batches.length,
			};
		});
	}

	private judgeBatch(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		batch: ReviewFindingJudgeBatch,
	): Effect.Effect<JudgedBatch, ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const fields = {
				candidateCount: batch.findings.length,
				modelName: model.apiName,
				reviewRunId: input.reviewRunId,
			};
			const result = yield* Effect.tryPromise({
				try: () => this.judge.judge(model, input, batch.input),
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
			return {
				findings: batch.findings.map((finding, index) =>
					toStoredFinding(finding, validation.judgments[index]!),
				),
				usage: result.usage,
			};
		});
	}

	private loadInput(
		run: RunnableReviewRun,
	): Effect.Effect<ReviewInputLoadResult, ReviewProcessingFailure> {
		return Effect.tryPromise({
			try: () => this.inputSource.load(run),
			catch: () => new ReviewProcessingFailure({ errorCode: "github_diff_unavailable" }),
		});
	}

	private reviewChunk(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		chunk: ReviewInput["chunks"][number],
	): Effect.Effect<ReviewModelResult, ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const result = yield* Effect.tryPromise({
				try: () => this.model.review(model, input, chunk),
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

	private fail(run: RunnableReviewRun, errorCode: ReviewRunErrorCode, startedAt: number): void {
		this.repository.failReviewRun(run.id, errorCode);
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

function addUsage(first: ReviewTokenUsage, second: ReviewTokenUsage): ReviewTokenUsage {
	return {
		inputTokens: first.inputTokens + second.inputTokens,
		outputTokens: first.outputTokens + second.outputTokens,
		cacheTokens: first.cacheTokens + second.cacheTokens,
		costUsdMicros: first.costUsdMicros + second.costUsdMicros,
	};
}

function roundUsageCost(usage: ReviewTokenUsage): ReviewTokenUsage {
	return { ...usage, costUsdMicros: Math.round(usage.costUsdMicros) };
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
