import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Data, Effect } from "effect";
import type { ReviewModelConfiguration } from "../../models/types/model-catalog.types.js";
import { ReviewSourceArtifactService } from "../services/review-source-artifact.service.js";
import {
	ReviewSourceCatalogService,
	type ReviewSourceBackend,
} from "../services/review-source-catalog.service.js";
import type {
	ReviewExecution,
	ReviewFindingJudge,
	ReviewInput,
	ReviewModel,
	ReviewUsageEvent,
} from "../types/review-input.types.js";
import type { ReviewMetric } from "../types/review-metrics.types.js";
import type { ReviewFinding } from "../types/review-run.types.js";
import type {
	ReviewSourceDocument,
	ReviewSourceEntry,
	ReviewSourceUnavailable,
} from "../types/review-source.types.js";
import { REVIEW_STRATEGY_VERSION } from "../types/review-conclusion.types.js";
import {
	createReviewFindingJudgeBatches,
	type ChunkFindingCandidate,
} from "../utils/review-finding-evidence.util.js";
import { ReviewUsageLedger } from "../utils/review-usage-ledger.util.js";
import {
	evaluationCorpusHash,
	evaluationFindingSchema,
	evaluationInvestigationSchema,
	type ReviewEvaluationCase,
	type ReviewEvaluationCaseResult,
	type ReviewEvaluationManifest,
	type ReviewEvaluationResult,
} from "./review-evaluation.schemas.js";

class EvaluationFailure extends Data.TaggedError("EvaluationFailure")<{ readonly code: string }> {}
export interface ReviewEvaluationDependencies {
	readonly reviewer: ReviewModel;
	readonly judge: ReviewFindingJudge;
	readonly codeRevision: string;
	readonly artifactDirectory?: string;
	readonly recordResult?: (result: ReviewEvaluationResult) => Promise<void>;
}

/** An isolated program: no completed-run reuse, database, webhook, or publication port. */
export function evaluateReviewCorpus(
	manifest: ReviewEvaluationManifest,
	dependencies: ReviewEvaluationDependencies,
): Effect.Effect<ReviewEvaluationResult, EvaluationFailure> {
	return Effect.gen(function* () {
		const result: ReviewEvaluationResult = {
			version: 1,
			experimentId: randomUUID(),
			corpusId: manifest.corpusId,
			corpusHash: evaluationCorpusHash(manifest),
			runtime: {
				codeRevision: dependencies.codeRevision,
				strategy: REVIEW_STRATEGY_VERSION,
				model: manifest.model,
				concurrency: manifest.concurrency,
				caseDeadlineMs: manifest.caseDeadlineMs,
			},
			cases: manifest.cases.map((entry) => ({
				caseId: entry.id,
				runId: randomUUID(),
				status: "pending",
				durationMs: 0,
				errorCode: null,
				findings: [],
				investigations: [],
				reviewUsage: null,
				judgeUsage: null,
				knownUsageSteps: 0,
				requestCount: 0,
				metrics: [],
			})),
		};
		const persist = (
			entry?: ReviewEvaluationCaseResult,
		): Effect.Effect<void, EvaluationFailure> => {
			if (entry !== undefined)
				result.cases = result.cases.map((previous) =>
					previous.caseId === entry.caseId ? entry : previous,
				);
			if (dependencies.recordResult === undefined) return Effect.void;
			const snapshot = { ...result, cases: [...result.cases] };
			return io(() => dependencies.recordResult!(snapshot), "checkpoint_unavailable");
		};
		yield* persist();
		const analyze = (directory: string) =>
			Effect.forEach(
				manifest.cases,
				(entry, index) =>
					evaluateCase(
						entry,
						manifest,
						dependencies,
						directory,
						result.cases[index]!.runId,
						persist,
					).pipe(Effect.flatMap((completed) => persist(completed))),
				{ concurrency: manifest.concurrency },
			);
		if (dependencies.artifactDirectory !== undefined)
			yield* analyze(dependencies.artifactDirectory);
		else
			yield* Effect.acquireUseRelease(
				io(() => mkdtemp(join(tmpdir(), "codekeat-evaluation-")), "scratch_unavailable"),
				analyze,
				(directory) =>
					Effect.promise(() => rm(directory, { recursive: true, force: true })),
			);
		return result;
	});
}

function evaluateCase(
	entry: ReviewEvaluationCase,
	manifest: ReviewEvaluationManifest,
	dependencies: ReviewEvaluationDependencies,
	directory: string,
	runId: string,
	persist: (entry: ReviewEvaluationCaseResult) => Effect.Effect<void, EvaluationFailure>,
): Effect.Effect<ReviewEvaluationCaseResult, EvaluationFailure> {
	return Effect.gen(function* () {
		const startedAt = performance.now();
		const metrics: ReviewMetric[] = [];
		const calls = new Set<string>();
		const ledger = new ReviewUsageLedger(
			{ reviewUsage: null, judgeUsage: null, judgeCallCount: 0, processingDurationMs: 0 },
			manifest.model,
		);
		const investigations: ReviewEvaluationCaseResult["investigations"] = [];
		const input = inputForCase(entry, runId);
		const sources = frozenCatalog(entry, directory, runId);
		const recordUsage = (event: ReviewUsageEvent): void => {
			ledger.record(event);
			calls.add(`${event.stage}:${event.callId}:${event.stepNumber}`);
		};
		const summary = (): Omit<
			ReviewEvaluationCaseResult,
			"status" | "errorCode" | "findings"
		> => ({
			caseId: entry.id,
			runId,
			durationMs: Math.round(performance.now() - startedAt),
			reviewUsage: ledger.usage("review"),
			judgeUsage: ledger.usage("judge"),
			knownUsageSteps: calls.size,
			requestCount: metrics
				.filter(isModelRequestMetric)
				.reduce((total, metric) => total + metric.requestCount, 0),
			metrics: [...metrics],
			investigations: [...investigations],
		});
		yield* persist({ ...summary(), status: "running", errorCode: null, findings: [] });
		const analyze = analyzeCase(
			input,
			manifest.model,
			dependencies,
			investigations,
			(signal) => ({
				signal,
				sources,
				recordUsage,
				recordMetric: (metric) => metrics.push(metric),
			}),
		);
		const outcome = yield* analyze.pipe(
			Effect.timeoutOrElse({
				duration: manifest.caseDeadlineMs,
				orElse: () => Effect.fail(new EvaluationFailure({ code: "deadline" })),
			}),
			Effect.result,
			Effect.onInterrupt(() =>
				persist({
					...summary(),
					status: "cancelled",
					errorCode: "cancelled",
					findings: [],
				}),
			),
		);
		const base = summary();
		if (outcome._tag === "Failure")
			return {
				...base,
				status:
					outcome.failure.code === "deadline"
						? ("deadline" as const)
						: ("failed" as const),
				errorCode: outcome.failure.code,
				findings: [],
			};
		return { ...base, ...outcome.success, errorCode: null };
	});
}

function isModelRequestMetric(metric: ReviewMetric): boolean {
	return (
		metric.scope === "operation" && (metric.phase === "generation" || metric.phase === "judge")
	);
}

function analyzeCase(
	input: ReviewInput,
	model: ReviewModelConfiguration,
	dependencies: ReviewEvaluationDependencies,
	investigations: ReviewEvaluationCaseResult["investigations"],
	execution: (signal: AbortSignal) => ReviewExecution,
): Effect.Effect<
	{ readonly findings: ReviewFinding[]; readonly status: "complete" | "incomplete" },
	EvaluationFailure
> {
	return Effect.gen(function* () {
		const generated = yield* Effect.forEach(
			input.chunks,
			(chunk) =>
				io(async (signal) => {
					const result = await dependencies.reviewer.review(
						model,
						input,
						chunk,
						execution(signal),
					);
					investigations.push(archiveInvestigation(chunk.index, result.investigation));
					const findings = result.findings.map((finding) =>
						evaluationFindingSchema.parse(finding),
					);
					if (
						!findings.every((finding) =>
							chunk.changedLines.get(finding.path)?.has(finding.line),
						)
					)
						throw new Error("Invalid finding location.");
					return {
						complete:
							result.investigation.kind === "verified" &&
							result.investigation.conclusion.status === "complete",
						candidates: findings.map((finding): ChunkFindingCandidate => ({
							chunk,
							finding,
							investigation: result.investigation,
						})),
					};
				}, "review_failed"),
			{ concurrency: 1 },
		);
		const unique = new Map<string, ChunkFindingCandidate>();
		for (const candidate of generated.flatMap((entry) => entry.candidates))
			unique.set(
				JSON.stringify([
					candidate.finding.path,
					candidate.finding.line,
					candidate.finding.title,
					candidate.finding.rationale,
				]),
				candidate,
			);
		const batches = createReviewFindingJudgeBatches([...unique.values()]);
		if (batches === null)
			return yield* new EvaluationFailure({ code: "finding_evidence_invalid" });
		const judged = yield* Effect.forEach(
			batches,
			(batch) =>
				io(async (signal) => {
					const result = await dependencies.judge.judge(
						model,
						input,
						batch.input,
						execution(signal),
					);
					const judgments = new Map(
						result.judgments.map((entry) => [entry.index, entry.judgment]),
					);
					if (
						judgments.size !== batch.findings.length ||
						result.judgments.length !== batch.findings.length
					)
						throw new Error("Incomplete judge coverage.");
					return batch.findings.flatMap((finding, index) => {
						const judgment = judgments.get(index);
						if (judgment === undefined) throw new Error("Invalid judgment index.");
						if (judgment.kind === "rejected") return [];
						return [
							{
								...finding,
								severity:
									judgment.kind === "severity_changed"
										? judgment.severity
										: finding.severity,
							},
						];
					});
				}, "judge_failed"),
			{ concurrency: 1 },
		);
		return {
			findings: judged.flat(),
			status: generated.every((entry) => entry.complete)
				? ("complete" as const)
				: ("incomplete" as const),
		};
	});
}

function inputForCase(entry: ReviewEvaluationCase, runId: string): ReviewInput {
	return {
		repositoryFullName: entry.repositoryFullName,
		headSha: entry.headSha,
		baseSha: entry.baseSha,
		title: entry.title,
		body: entry.body,
		reviewRunId: runId,
		githubInstallationAccountLogin: "evaluation",
		pullRequestNumber: 1,
		chunks: entry.chunks.map((chunk, index) => ({
			...chunk,
			index,
			total: entry.chunks.length,
			changedLines: new Map(
				Object.entries(chunk.changedLines).map(([path, lines]) => [path, new Set(lines)]),
			),
		})),
		repositoryContext: {
			repositoryFullName: entry.repositoryFullName,
			revision: entry.headSha,
			omittedFileCount: 0,
			files: entry.sources
				.filter((source) => source.role === "head")
				.map((source) => ({
					kind: "catalog" as const,
					path: source.path,
					source: {
						role: source.role,
						path: source.path,
						revision: source.revision,
						contentHash: source.contentHash,
						repositoryFullName: entry.repositoryFullName,
					},
				})),
		},
	};
}

function frozenCatalog(
	entry: ReviewEvaluationCase,
	directory: string,
	runId: string,
): ReviewSourceCatalogService {
	const documents: ReviewSourceDocument[] = entry.sources.map((source) => ({
		source: {
			role: source.role,
			path: source.path,
			revision: source.revision,
			contentHash: source.contentHash,
			repositoryFullName: entry.repositoryFullName,
		},
		content: source.content,
	}));
	const backend: ReviewSourceBackend = {
		entries: (role) =>
			Effect.succeed(
				documents
					.filter((document) => document.source.role === role)
					.map((document): ReviewSourceEntry => ({
						...document.source,
						kind: "file",
						sizeBytes: Buffer.byteLength(document.content),
					})),
			),
		document: (source) => {
			const document = documents.find(
				(candidate) =>
					candidate.source.role === source.role &&
					candidate.source.path === source.path &&
					(source.contentHash == null ||
						source.contentHash === candidate.source.contentHash),
			);
			return document === undefined
				? Effect.fail({
						kind: "unavailable",
						reason: "revision_unavailable",
					} satisfies ReviewSourceUnavailable)
				: Effect.succeed(document);
		},
	};
	return new ReviewSourceCatalogService(
		[
			{ role: "head", repositoryFullName: entry.repositoryFullName, revision: entry.headSha },
			{
				role: "before",
				repositoryFullName: entry.repositoryFullName,
				revision: entry.mergeBaseSha,
			},
		],
		backend,
		new ReviewSourceArtifactService(directory, runId),
		[],
	);
}

function io<A>(
	operation: (signal: AbortSignal) => Promise<A>,
	code: string,
): Effect.Effect<A, EvaluationFailure> {
	return Effect.tryPromise({ try: operation, catch: () => new EvaluationFailure({ code }) });
}

function archiveInvestigation(
	chunkIndex: number,
	investigation: import("../types/review-input.types.js").ReviewInvestigation,
): ReviewEvaluationCaseResult["investigations"][number] {
	const verified = investigation.kind === "verified";
	return evaluationInvestigationSchema.parse({
		chunkIndex,
		conclusion: verified ? investigation.conclusion : null,
		context: verified ? investigation.context : investigation.kind,
		exchanges: verified || investigation.kind === "available" ? investigation.exchanges : [],
	});
}
