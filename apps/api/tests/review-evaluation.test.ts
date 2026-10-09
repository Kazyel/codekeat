import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { evaluateReviewCorpus } from "../src/features/review/evaluation/review-evaluation.runner.js";
import { runReviewEvaluationCli } from "../src/features/review/evaluation/review-evaluation.cli.js";
import {
	reviewEvaluationManifestSchema,
	type ReviewEvaluationLabels,
	type ReviewEvaluationResult,
} from "../src/features/review/evaluation/review-evaluation.schemas.js";
import { scoreReviewEvaluation } from "../src/features/review/evaluation/review-evaluation-score.js";
import { createReviewMetric } from "../src/features/review/types/review-metrics.types.js";
import type { ReviewModelResult } from "../src/features/review/types/review-input.types.js";

const RUN = "cce8c60c-4858-4bcb-9935-2813c532d684";
const HASH = "a".repeat(64);
const MODEL = {
	id: "model",
	apiName: "model",
	inputNanoUsdPerToken: 750,
	cachedInputNanoUsdPerToken: 75,
	outputNanoUsdPerToken: 3750,
};
const finding = {
	severity: "high" as const,
	path: "src/cost.ts",
	line: 4,
	title: "Cached usage loses charges",
	rationale: "Cached input and output still have a price.",
};

function result(): ReviewEvaluationResult {
	return {
		version: 1,
		experimentId: RUN,
		corpusId: "corpus",
		corpusHash: HASH,
		runtime: {
			codeRevision: "b".repeat(40),
			strategy: "test",
			model: MODEL,
			concurrency: 1,
			caseDeadlineMs: 100,
		},
		cases: [
			{
				caseId: "case-a",
				runId: RUN,
				status: "incomplete",
				investigations: [],
				durationMs: 10,
				errorCode: null,
				findings: [finding],
				reviewUsage: {
					inputTokens: 100,
					outputTokens: 20,
					cacheTokens: 100,
					costUsdMicros: 82.5,
				},
				judgeUsage: null,
				knownUsageSteps: 1,
				requestCount: 1,
				metrics: [],
			},
		],
	};
}
function labels(): ReviewEvaluationLabels {
	return {
		version: 1,
		corpusHash: HASH,
		cases: [
			{
				caseId: "case-a",
				defects: [{ id: "charges", path: "src/cost.ts", startLine: 4, endLine: 4 }],
			},
		],
		annotations: [],
	};
}
async function manifest(): Promise<ReturnType<typeof reviewEvaluationManifestSchema.parse>> {
	return reviewEvaluationManifestSchema.parse(
		JSON.parse(
			await readFile(
				fileURLToPath(
					new URL(
						"../src/features/review/evaluation/fixtures/usage-contract.manifest.json",
						import.meta.url,
					),
				),
				"utf8",
			),
		),
	);
}

describe("isolated review evaluation", () => {
	it("keeps unlabelled findings out of precision and requires a human match for recall", () => {
		const groundTruth = labels();
		expect(scoreReviewEvaluation(result(), groundTruth)).toMatchObject({
			precision: null,
			recall: 0,
			unlabelledFindings: 1,
			knownCostUsdMicros: 82.5,
		});
		groundTruth.annotations.push({
			runId: RUN,
			findingIndex: 0,
			verdict: "true_positive",
			defectId: "charges",
		});
		expect(scoreReviewEvaluation(result(), groundTruth)).toMatchObject({
			precision: 1,
			recall: 1,
			unlabelledFindings: 0,
		});
	});
	it("scores private files offline and refuses to overwrite an existing score", async () => {
		const directory = await mkdtemp(join(tmpdir(), "evaluation-score-"));
		try {
			const resultPath = join(directory, "results.json");
			const labelsPath = join(directory, "labels.json");
			const scorePath = join(directory, "score.json");
			await writeFile(resultPath, JSON.stringify(result()));
			await writeFile(labelsPath, JSON.stringify(labels()));
			const arguments_ = ["score", resultPath, labelsPath, scorePath];
			await runReviewEvaluationCli(arguments_);
			expect(JSON.parse(await readFile(scorePath, "utf8"))).toMatchObject({
				precision: null,
				recall: 0,
				unlabelledFindings: 1,
			});
			expect((await stat(scorePath)).mode & 0o777).toBe(0o600);
			await expect(runReviewEvaluationCli(arguments_)).rejects.toThrow(/EEXIST/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("counts unknown paid requests and measures terminal cases without treating pending work as fast", () => {
		const output = result();
		output.cases[0]!.metrics = [
			createReviewMetric({
				phase: "judge",
				durationMs: 2,
				outcome: "failed",
				requestCount: 1,
			}),
		];
		output.cases.push({
			...output.cases[0]!,
			caseId: "case-b",
			runId: "3b706273-c943-40dc-af9c-8dfab22fa520",
			status: "pending",
			durationMs: 0,
			findings: [],
			reviewUsage: null,
			judgeUsage: null,
			knownUsageSteps: 0,
			requestCount: 0,
			metrics: [],
		});
		const groundTruth = labels();
		groundTruth.cases.push({ caseId: "case-b", defects: [] });
		expect(scoreReviewEvaluation(output, groundTruth)).toMatchObject({
			unknownUsageCases: 1,
			incompleteCases: 2,
			measuredCases: 1,
			durationP50Ms: 10,
			durationP95Ms: 10,
		});
		output.cases[0]!.status = "failed";
		output.cases[0]!.errorCode = "prepare_failed";
		output.cases[0]!.findings = [];
		output.cases[0]!.reviewUsage = null;
		output.cases[0]!.knownUsageSteps = 0;
		output.cases[0]!.requestCount = 0;
		output.cases[0]!.metrics = [
			createReviewMetric({
				phase: "prepare",
				durationMs: 2,
				outcome: "failed",
				requestCount: 1,
			}),
		];
		expect(scoreReviewEvaluation(output, groundTruth).unknownUsageCases).toBe(0);
	});
	it("keeps actual requests visible when no provider usage receipt is available", async () => {
		const input = await manifest();
		input.cases = [input.cases[0]!];
		const output = await Effect.runPromise(
			evaluateReviewCorpus(input, {
				codeRevision: "a".repeat(40),
				reviewer: {
					review: async (_model, _input, _chunk, execution) => {
						execution.recordMetric(
							createReviewMetric({
								phase: "generation",
								durationMs: 5,
								outcome: "success",
								requestCount: 1,
							}),
						);
						return {
							findings: [],
							investigation: { kind: "not_enabled" },
							usage: {
								inputTokens: 0,
								outputTokens: 0,
								cacheTokens: 0,
								costUsdMicros: 0,
							},
						};
					},
				},
				judge: {
					judge: async () => {
						throw new Error("No candidates to judge.");
					},
				},
			}),
		);
		const score = scoreReviewEvaluation(output, {
			version: 1,
			corpusHash: output.corpusHash,
			cases: [{ caseId: input.cases[0]!.id, defects: [] }],
			annotations: [],
		});
		expect(score).toMatchObject({
			requestCount: 1,
			knownUsageSteps: 0,
			unknownUsageCases: 1,
			knownCostUsdMicros: 0,
		});
	});
	it.each([
		"line-map",
		"head",
		"before",
		"missing-source",
		"truncated-hunk",
		"missing-blank-prefix",
	] as const)(
		"rejects an inconsistent frozen %s independently of source hashes",
		async (invalid) => {
			const input = await manifest();
			const entry = input.cases[0]!;
			if (invalid === "line-map") entry.chunks[0]!.changedLines["src/cost.ts"] = [5];
			if (invalid === "head" || invalid === "before") {
				const source = entry.sources.find(
					(source) => source.role === invalid && source.path === "src/cost.ts",
				)!;
				source.content = source.content.replace("const uncached", "const replaced");
				source.contentHash = `sha256:${createHash("sha256").update(source.content).digest("hex")}`;
			}
			if (invalid === "missing-source")
				entry.sources = entry.sources.filter((source) => source.path !== "src/cost.ts");
			if (invalid === "truncated-hunk")
				entry.chunks[0]!.diff = entry.chunks[0]!.diff.replace(" }\n", "");
			if (invalid === "missing-blank-prefix") {
				// parse-diff consumes the unprefixed final empty entry as a context row.
				entry.chunks = [
					{
						diff: "diff --git a/src/cost.ts b/src/cost.ts\n--- a/src/cost.ts\n+++ b/src/cost.ts\n@@ -1 +1 @@\n",
						referenceBefore: "",
						referenceAfter: "",
						changedLines: { "src/cost.ts": [] },
					},
				];
				entry.sources = entry.sources
					.filter((source) => source.path === "src/cost.ts")
					.map((source) => ({
						...source,
						content: "\n",
						contentHash: `sha256:${createHash("sha256").update("\n").digest("hex")}`,
					}));
			}
			expect(() => reviewEvaluationManifestSchema.parse(input)).toThrow(
				/Diff hunks, changed lines and frozen sources must agree/,
			);
		},
	);
	it.each([
		"rename-crlf",
		"new-file",
		"deleted-file",
		"split-chunks",
		"no-final-newline",
	] as const)("accepts truthful %s snapshot hunks", async (shape) => {
		const input = await manifest();
		input.cases = [input.cases[0]!];
		const entry = input.cases[0]!;
		const before = shape === "rename-crlf" ? "old\r\n" : "old\n";
		const head = shape === "rename-crlf" ? "new\r\n" : "new\n";
		const oldPath = shape === "new-file" ? "/dev/null" : "src/old.ts";
		const newPath = shape === "deleted-file" ? "/dev/null" : "src/new.ts";
		entry.sources = [];
		const addSource = (role: "head" | "before", path: string, content: string): void => {
			entry.sources.push({
				role,
				path,
				content,
				revision: role === "head" ? entry.headSha : entry.mergeBaseSha,
				contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
			});
		};
		if (oldPath !== "/dev/null")
			addSource("before", oldPath, shape === "no-final-newline" ? "old" : before);
		if (newPath !== "/dev/null")
			addSource("head", newPath, shape === "no-final-newline" ? "new" : head);
		const header = `diff --git a/src/old.ts b/src/new.ts\n--- ${oldPath === "/dev/null" ? oldPath : `a/${oldPath}`}\n+++ ${newPath === "/dev/null" ? newPath : `b/${newPath}`}\n`;
		const deletion =
			oldPath === "/dev/null"
				? ""
				: `-${before.trimEnd()}${shape === "rename-crlf" ? "\r" : ""}\n${shape === "no-final-newline" ? "\\ No newline at end of file\n" : ""}`;
		const addition =
			newPath === "/dev/null"
				? ""
				: `+${head.trimEnd()}${shape === "rename-crlf" ? "\r" : ""}\n${shape === "no-final-newline" ? "\\ No newline at end of file\n" : ""}`;
		entry.chunks = [
			{
				diff: `${header}@@ -${oldPath === "/dev/null" ? "0,0" : "1"} +${newPath === "/dev/null" ? "0,0" : "1"} @@\n${deletion}${addition}`,
				referenceBefore: "",
				referenceAfter: "",
				changedLines: {
					[newPath === "/dev/null" ? oldPath : newPath]:
						newPath === "/dev/null" ? [] : [1],
				},
			},
		];
		if (shape === "split-chunks") {
			entry.sources = [];
			addSource("before", oldPath, "old\nkept\nold-last\n");
			addSource("head", newPath, "new\nkept\nnew-last\n");
			entry.chunks.push({
				diff: `${header}@@ -3 +3 @@\n-old-last\n+new-last\n`,
				referenceBefore: "",
				referenceAfter: "",
				changedLines: { [newPath]: [3] },
			});
		}
		expect(reviewEvaluationManifestSchema.safeParse(input).success).toBe(true);
	});
	it.each(["pending", "running", "failed", "deadline", "cancelled"] as const)(
		"rejects findings in %s cases",
		(status) => {
			const output = result();
			output.cases[0]!.status = status;
			output.cases[0]!.errorCode =
				status === "pending" || status === "running" ? null : status;
			expect(() => scoreReviewEvaluation(output, labels())).toThrow(
				/cannot publish findings/,
			);
		},
	);
	it.each(["corpus", "range", "duplicate"])(
		"rejects mismatched %s labels instead of producing an optimistic score",
		(invalid) => {
			const groundTruth = labels();
			groundTruth.annotations.push({
				runId: RUN,
				findingIndex: 0,
				verdict: "true_positive",
				defectId: "charges",
			});
			if (invalid === "corpus") groundTruth.corpusHash = "c".repeat(64);
			if (invalid === "range") groundTruth.cases[0]!.defects[0]!.path = "other.ts";
			if (invalid === "duplicate") groundTruth.annotations.push(groundTruth.annotations[0]!);
			expect(() => scoreReviewEvaluation(result(), groundTruth)).toThrow(
				/mismatch|range|Duplicate/,
			);
		},
	);
	it("rejects frozen content tampering and revision drift before provider execution", async () => {
		const input = await manifest();
		input.cases[0]!.sources[0]!.content += "changed";
		expect(reviewEvaluationManifestSchema.safeParse(input).success).toBe(false);
		const drifted = await manifest();
		drifted.cases[0]!.sources[0]!.revision = "c".repeat(40);
		expect(reviewEvaluationManifestSchema.safeParse(drifted).success).toBe(false);
	});
	it("preserves the diff merge base when the target branch tip has advanced", async () => {
		const input = await manifest();
		input.cases = [input.cases[0]!];
		const entry = input.cases[0]!;
		entry.baseSha = "e".repeat(40);
		expect(reviewEvaluationManifestSchema.safeParse(input).success).toBe(true);
		let observedBase: string | null = null;
		let observedBefore: string | null = null;
		await Effect.runPromise(
			evaluateReviewCorpus(input, {
				codeRevision: "a".repeat(40),
				reviewer: {
					review: async (_model, reviewInput, _chunk, execution) => {
						observedBase = reviewInput.baseSha;
						const before = await execution.sources!.read(
							{
								source: { role: "before", path: "src/cost.ts" },
								range: { kind: "lines", startLine: 1, lineCount: 10 },
							},
							execution.signal,
						);
						if (before.kind !== "loaded")
							throw new Error("Frozen before source was unavailable.");
						observedBefore = before.source.revision;
						return {
							findings: [],
							investigation: { kind: "not_enabled" },
							usage: {
								inputTokens: 0,
								outputTokens: 0,
								cacheTokens: 0,
								costUsdMicros: 0,
							},
						};
					},
				},
				judge: {
					judge: async () => {
						throw new Error("No candidates to judge.");
					},
				},
			}),
		);
		expect(observedBase).toBe("e".repeat(40));
		expect(observedBefore).toBe(entry.mergeBaseSha);
	});
	it("uses fresh run identities and marks legacy empty results incomplete", async () => {
		const input = await manifest();
		const empty: ReviewModelResult = {
			findings: [],
			investigation: { kind: "not_enabled" },
			usage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsdMicros: 0 },
		};
		const dependencies = {
			codeRevision: "a".repeat(40),
			reviewer: { review: async () => empty },
			judge: {
				judge: async () => {
					throw new Error("No candidates to judge.");
				},
			},
		};
		const first = await Effect.runPromise(evaluateReviewCorpus(input, dependencies));
		const second = await Effect.runPromise(evaluateReviewCorpus(input, dependencies));
		expect(first.cases.map((entry) => entry.status)).toEqual(["incomplete", "incomplete"]);
		expect(first.cases[0]!.runId).not.toBe(second.cases[0]!.runId);
		expect(first.corpusHash).toBe(second.corpusHash);
		expect(first.cases[0]!.reviewUsage).toBeNull();
	});
	it("cancels expired inference and retains usage received before its deadline", async () => {
		const input = await manifest();
		input.cases = [input.cases[0]!];
		input.caseDeadlineMs = 100;
		const started = Effect.runSync(Deferred.make<void>());
		let aborted = false;
		const program = evaluateReviewCorpus(input, {
			codeRevision: "a".repeat(40),
			reviewer: {
				review: async (_model, _input, _chunk, execution) => {
					Effect.runSync(Deferred.succeed(started, undefined));
					execution.recordUsage({
						stage: "review",
						callId: RUN,
						stepNumber: 0,
						usage: {
							inputTokens: 100,
							outputTokens: 20,
							cacheTokens: 100,
							costUsdMicros: 82.5,
						},
					});
					return new Promise<ReviewModelResult>((_resolve, reject) => {
						execution.signal.addEventListener(
							"abort",
							() => {
								aborted = true;
								reject(new Error("Aborted"));
							},
							{ once: true },
						);
					});
				},
			},
			judge: {
				judge: async () => {
					throw new Error("No candidates to judge.");
				},
			},
		});
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(program);
				yield* Deferred.await(started);
				yield* TestClock.adjust(100);
				return yield* Fiber.join(fiber);
			}).pipe(Effect.provide(TestClock.layer())),
		);
		expect(aborted).toBe(true);
		expect(result.cases[0]).toMatchObject({
			status: "deadline",
			knownUsageSteps: 1,
			reviewUsage: { costUsdMicros: 83 },
		});
	});
	it("checkpoints received usage when the whole experiment is interrupted", async () => {
		const input = await manifest();
		input.cases = [input.cases[0]!];
		const started = Effect.runSync(Deferred.make<void>());
		const checkpoints: ReviewEvaluationResult[] = [];
		const program = evaluateReviewCorpus(input, {
			codeRevision: "a".repeat(40),
			recordResult: async (snapshot) => {
				checkpoints.push(snapshot);
			},
			reviewer: {
				review: async (_model, _input, _chunk, execution) => {
					execution.recordUsage({
						stage: "review",
						callId: RUN,
						stepNumber: 0,
						usage: {
							inputTokens: 100,
							outputTokens: 20,
							cacheTokens: 100,
							costUsdMicros: 82.5,
						},
					});
					Effect.runSync(Deferred.succeed(started, undefined));
					return new Promise<ReviewModelResult>((_resolve, reject) =>
						execution.signal.addEventListener(
							"abort",
							() => reject(new Error("Aborted")),
							{ once: true },
						),
					);
				},
			},
			judge: {
				judge: async () => {
					throw new Error("No candidates to judge.");
				},
			},
		});
		await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(program);
				yield* Deferred.await(started);
				yield* Fiber.interrupt(fiber);
			}),
		);
		expect(checkpoints.at(-1)?.cases[0]).toMatchObject({
			status: "cancelled",
			errorCode: "cancelled",
			knownUsageSteps: 1,
			reviewUsage: { costUsdMicros: 83 },
		});
	});
});
