import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { Cause, Data, Effect, Exit, Result } from "effect";
import type { Logger } from "pino";

import {
	ReviewContextCapacityExceeded,
	ReviewSourceCoverageIncomplete,
	ReviewModelResponseError,
	ReviewConclusionValidationError,
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
	ReviewExecution,
	ReviewUsageEvent,
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
import type { ReviewSourceCatalog } from "../types/review-source.types.js";
import { createReviewMetric, type ReviewMetric } from "../types/review-metrics.types.js";
import type { ReviewTelemetryRepository } from "../repositories/review-telemetry.repository.js";
import type { ReviewWorkRepository } from "../repositories/review-work.repository.js";
import { ReviewWorkExecutor } from "./review-work-executor.service.js";
import {
	encodeReviewChunk,
	decodeReviewChunk,
	encodeReviewCheckpoint,
	decodeReviewCheckpoint,
	decodeJudgeBatch,
	decodeStoredFindings,
} from "../utils/review-work-codec.util.js";
import {
	planReviewChunks,
	reviewPlanFingerprint,
	splitReviewChunk,
	assertReviewCoverage,
} from "../utils/review-work-planner.util.js";
import { REVIEW_STRATEGY_VERSION } from "../types/review-conclusion.types.js";
export interface ReviewProcessingOptions {
	readonly unitConcurrency: number;
	readonly getModelCapacity: (
		model: string,
		signal: AbortSignal,
	) => Promise<{ readonly inputTokenLimit: number }>;
}
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
		private readonly queue: ReviewWorkQueue,
		private readonly logger: Logger,
		private readonly work: ReviewWorkRepository,
		private readonly telemetry: ReviewTelemetryRepository,
		private readonly options: ReviewProcessingOptions,
	) {}

	async process(reviewRunId: string): Promise<void> {
		const queuedAt = this.repository.queuedAt(reviewRunId);
		const run = this.repository.claimQueuedReviewRun(reviewRunId);
		if (run === null) {
			return;
		}

		const startedAt = performance.now();
		const previousDuration = this.repository.readReviewRunUsage(run.id).processingDurationMs;
		this.work.resetInterrupted(run.id);
		this.telemetry.record(
			run.id,
			createReviewMetric({
				phase: "queue",
				scope: "phase",
				durationMs: queuedAt === null ? 0 : Date.now() - Date.parse(queuedAt),
				outcome: "success",
			}),
		);
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
				Effect.catchDefect(() =>
					Effect.fail(
						new ReviewProcessingFailure({ errorCode: "review_checkpoint_unavailable" }),
					),
				),
				Effect.result,
			),
		);
		if (Result.isFailure(analysis)) {
			await this.handleFailure(run, analysis.failure, ledger, startedAt, previousDuration);
			return;
		}
		await this.applyOutcome(run, analysis.success, ledger, startedAt);
	}

	private async handleFailure(
		run: RunnableReviewRun,
		failure: ReviewProcessingFailure,
		ledger: ReviewUsageLedger,
		startedAt: number,
		previousDuration: number,
	): Promise<void> {
		if (failure.errorCode !== "review_run_timeout") {
			this.fail(run, failure.errorCode, ledger, startedAt);
			return;
		}
		this.work.resetInterrupted(run.id);
		this.repository.yieldReviewRun(run.id, previousDuration + elapsedMilliseconds(startedAt));
		await this.queue.enqueueReview(run.id);
	}

	private async applyOutcome(
		run: RunnableReviewRun,
		outcome: AnalysisOutcome,
		ledger: ReviewUsageLedger,
		startedAt: number,
	): Promise<void> {
		if (outcome.kind === "ignored") {
			this.repository.ignoreReviewRun(run.id, outcome.ignoreReason);
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
				inputStageMetric,
			);
			if (loaded.kind !== "ready") return loaded;
			this.work.ensurePlan(
				run.id,
				reviewPlanFingerprint(loaded.input, run.model.apiName, REVIEW_STRATEGY_VERSION),
			);
			const candidates = yield* this.observeStage(
				run,
				"candidate_generation",
				this.generateCandidates(run.model, loaded.input, loaded.sources, ledger),
			);
			const findings = yield* this.observeStage(
				run,
				"candidate_judgment",
				this.judgeCandidates(run.model, loaded.input, loaded.sources, candidates, ledger),
			);
			return { kind: "completed", input: loaded.input, findings } as const;
		});
	}

	private observeStage<A>(
		run: RunnableReviewRun,
		stage: "context_load" | "candidate_generation" | "candidate_judgment",
		program: Effect.Effect<A, ReviewProcessingFailure>,
		describeOutcome: (value: A) => ReviewStageOutcome = () => "completed",
		describeMetric: (value: A) => Partial<ReviewMetric> = () => ({}),
	): Effect.Effect<A, ReviewProcessingFailure> {
		return Effect.suspend(() => {
			const startedAt = performance.now();
			return program.pipe(
				Effect.onExit((exit) =>
					Effect.sync(() => {
						this.telemetry.record(
							run.id,
							createReviewMetric({
								phase: stagePhase(stage),
								scope: "phase",
								durationMs: elapsedMilliseconds(startedAt),
								outcome: stageMetricOutcome(exit, describeOutcome),
								...(Exit.isSuccess(exit) ? describeMetric(exit.value) : {}),
							}),
						);
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
						);
					}),
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
		const durationMs =
			this.repository.readReviewRunUsage(run.id).processingDurationMs +
			elapsedMilliseconds(startedAt);
		const reviewReportId = this.repository.completeReviewRun(run.id, {
			reviewUsage: ledger.usage("review") ?? EMPTY_USAGE,
			judgeUsage: ledger.usage("judge") ?? EMPTY_USAGE,
			findings: outcome.findings,
			reviewReportId: randomUUID(),
			reviewStrategyVersion: REVIEW_STRATEGY_VERSION,
			changedLineCount: countChangedLines(outcome.input),
			reviewChunkCount: this.work.listLeaves(run.id, "review").length,
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
		sources: ReviewSourceCatalog | null,
		ledger: ReviewUsageLedger,
	): Effect.Effect<readonly ChunkFindingCandidate[], ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const capacity = yield* Effect.tryPromise({
				try: (signal) => this.options.getModelCapacity(model.apiName, signal),
				catch: () =>
					new ReviewProcessingFailure({ errorCode: "gemini_capacity_unavailable" }),
			});
			const planned = planReviewChunks(input, capacity.inputTokenLimit);
			this.work.ensureUnits(input.reviewRunId, "review", planned.map(encodeReviewChunk));
			const executor = new ReviewWorkExecutor(this.work, this.options.unitConcurrency);
			const results = yield* executor.execute(
				this.work.listLeaves(input.reviewRunId, "review"),
				{
					run: (unit) => {
						const chunk = {
							...decodeReviewChunk(unit.payloadJson),
							index: unit.ordinal + 1,
							total: Math.max(
								decodeReviewChunk(unit.payloadJson).total,
								unit.ordinal + 1,
							),
						};
						return this.reviewChunk(model, input, chunk, sources, ledger, unit.id).pipe(
							Effect.map((result) => ({ chunk, result })),
						);
					},
					encode: encodeReviewCheckpoint,
					decode: decodeReviewCheckpoint,
					split: (unit, error) => {
						if (!isDivisibleFailure(error)) return null;
						return (
							splitReviewChunk(decodeReviewChunk(unit.payloadJson))?.map(
								encodeReviewChunk,
							) ?? null
						);
					},
				},
			);
			assertReviewCoverage(
				input.chunks,
				results.map((value) => value.chunk),
			);
			return deduplicateCandidates(
				[...results]
					.sort((a, b) => a.chunk.index - b.chunk.index)
					.flatMap(({ chunk, result }) =>
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
		sources: ReviewSourceCatalog | null,
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
			this.work.ensureUnits(
				input.reviewRunId,
				"judge",
				batches.map((batch) => JSON.stringify(batch)),
			);
			const executor = new ReviewWorkExecutor(this.work, this.options.unitConcurrency);
			const results = yield* executor.execute(
				this.work.listLeaves(input.reviewRunId, "judge"),
				{
					run: (unit) =>
						this.judgeBatch(
							model,
							input,
							decodeJudgeBatch(unit.payloadJson),
							sources,
							ledger,
							unit.id,
						),
					encode: (value) => JSON.stringify(value),
					decode: decodeStoredFindings,
					split: (unit, error) => {
						const batch = decodeJudgeBatch(unit.payloadJson);
						if (!isDivisibleFailure(error) || batch.findings.length <= 1) return null;
						return splitJudgeBatch(batch).map((part) => JSON.stringify(part));
					},
				},
			);
			return results.flat();
		});
	}

	private judgeBatch(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		batch: ReviewFindingJudgeBatch,
		sources: ReviewSourceCatalog | null,
		ledger: ReviewUsageLedger,
		unitId: string,
	): Effect.Effect<readonly StoredFinding[], ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const fields = {
				candidateCount: batch.findings.length,
				modelName: model.apiName,
				reviewRunId: input.reviewRunId,
			};
			const result = yield* Effect.tryPromise({
				try: (signal) =>
					this.judge.judge(
						model,
						input,
						batch.input,
						this.execution(input.reviewRunId, signal, sources, ledger, unitId),
					),
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
			try: (signal) =>
				this.inputSource.load(run, signal, (metric) =>
					this.telemetry.record(run.id, metric),
				),
			catch: () => new ReviewProcessingFailure({ errorCode: "github_diff_unavailable" }),
		});
	}

	private reviewChunk(
		model: RunnableReviewRun["model"],
		input: ReviewInput,
		chunk: ReviewInput["chunks"][number],
		sources: ReviewSourceCatalog | null,
		ledger: ReviewUsageLedger,
		unitId: string,
	): Effect.Effect<ReviewModelResult, ReviewProcessingFailure> {
		return Effect.gen({ self: this }, function* () {
			const result = yield* Effect.tryPromise({
				try: (signal) =>
					this.model.review(
						model,
						input,
						chunk,
						this.execution(input.reviewRunId, signal, sources, ledger, unitId),
					),
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

	private execution(
		runId: string,
		signal: AbortSignal,
		sources: ReviewSourceCatalog | null,
		ledger: ReviewUsageLedger,
		unitId: string,
	): ReviewExecution {
		return {
			signal,
			sources,
			recordUsage: (event: ReviewUsageEvent) => {
				if (this.work.recordUsage(runId, event)) ledger.record(event);
			},
			recordMetric: (metric) => this.telemetry.record(runId, { ...metric, unitId }),
		};
	}

	private modelFailure(
		error: unknown,
		stage: "review" | "judge",
		fields: Readonly<Record<string, string | number>>,
	): ReviewProcessingFailure {
		if (error instanceof ReviewSourceCoverageIncomplete)
			return new ReviewProcessingFailure({ errorCode: "review_source_coverage_incomplete" });
		if (error instanceof ReviewContextCapacityExceeded) {
			return new ReviewProcessingFailure({ errorCode: "review_context_capacity_exceeded" });
		}
		if (!(error instanceof ReviewModelResponseError)) {
			return new ReviewProcessingFailure({
				errorCode: requestFailureCode(stage),
			});
		}
		const diagnostic =
			error instanceof ReviewConclusionValidationError
				? { validationFailure: error.failure }
				: {};
		this.logger.warn(
			{ ...fields, reason: error.issue, ...diagnostic },
			`gemini_${stage}.invalid_response`,
		);
		return new ReviewProcessingFailure({
			errorCode: responseFailureCode(stage),
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
			processingDurationMs:
				this.repository.readReviewRunUsage(run.id).processingDurationMs +
				elapsedMilliseconds(startedAt),
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

function metricOutcome(outcome: ReviewStageOutcome): "success" | "failed" | "ignored" {
	return outcome === "completed" ? "success" : outcome;
}
function stagePhase(
	stage: "context_load" | "candidate_generation" | "candidate_judgment",
): ReviewMetric["phase"] {
	const phases = {
		context_load: "input",
		candidate_generation: "generation",
		candidate_judgment: "judge",
	} as const;
	return phases[stage];
}
function inputStageMetric(loaded: ReviewInputLoadResult): Partial<ReviewMetric> {
	if (loaded.kind !== "ready") return {};
	return {
		diffBytes: loaded.input.chunks.reduce(
			(total, chunk) => total + Buffer.byteLength(chunk.diff),
			0,
		),
		sourceBytes: loaded.input.repositoryContext.files.reduce(
			(bytes, file) => bytes + (file.kind === "loaded" ? Buffer.byteLength(file.content) : 0),
			0,
		),
		sourceCount: loaded.input.repositoryContext.files.length,
	};
}

function isDivisibleFailure(error: ReviewProcessingFailure): boolean {
	return (
		error.errorCode === "review_context_capacity_exceeded" ||
		error.errorCode === "review_source_coverage_incomplete"
	);
}

function requestFailureCode(stage: "review" | "judge"): ReviewRunErrorCode {
	return stage === "judge" ? "gemini_judge_request_failed" : "gemini_request_failed";
}
function responseFailureCode(stage: "review" | "judge"): ReviewRunErrorCode {
	return stage === "judge" ? "gemini_judge_invalid_response" : "gemini_invalid_response";
}

function stageMetricOutcome<A>(
	exit: Exit.Exit<A, ReviewProcessingFailure>,
	describe: (value: A) => ReviewStageOutcome,
): ReviewMetric["outcome"] {
	if (Exit.isSuccess(exit)) return metricOutcome(describe(exit.value));
	return Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "failed";
}
