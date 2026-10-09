import { randomUUID } from "node:crypto";
import { findings, reviewReports, reviewRuns } from "@codekeat/database";
import pino, { type Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import type { ReviewModelConfiguration } from "#features/models";

import {
	type FindingJudgment,
	type ReviewFinding,
	type ReviewFindingJudge,
	type ReviewFindingJudgeInput,
	type ReviewFindingJudgmentResult,
	type ReviewExecution,
	type ReviewInput,
	type ReviewInputLoadResult,
	type ReviewInputSource,
	type ReviewModel,
	ReviewModelResponseError,
	ReviewContextCapacityExceeded,
	type ReviewModelResult,
	ReviewRunProcessorService,
	ReviewWorkRepository,
	ReviewTelemetryRepository,
	type ReviewWorkQueue,
	type RunnableReviewRun,
} from "#features/review";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

const LOGGER = pino({ enabled: false });
const REVIEW_RUN_ID = "review-run-1";
const HEAD_SHA = "a".repeat(40);
const REVIEW_USAGE = {
	inputTokens: 100,
	outputTokens: 20,
	cacheTokens: 10,
	costUsdMicros: 10.5,
};
const JUDGE_USAGE = {
	inputTokens: 25,
	outputTokens: 5,
	cacheTokens: 2,
	costUsdMicros: 2.65,
};

class ReadyInputSource implements ReviewInputSource {
	readonly githubInstallationAccountLogins: string[] = [];

	constructor(private readonly input: ReviewInput) {}

	async load(run: RunnableReviewRun): Promise<ReviewInputLoadResult> {
		this.githubInstallationAccountLogins.push(run.githubInstallationAccountLogin);
		return { kind: "ready", input: this.input, sources: null };
	}
}

class StoppedInputSource implements ReviewInputSource {
	constructor(
		private readonly result: Exclude<ReviewInputLoadResult, { readonly kind: "ready" }>,
	) {}
	async load(): Promise<ReviewInputLoadResult> {
		return this.result;
	}
}

class RecordedModel implements ReviewModel {
	readonly id = randomUUID();
	readonly modelNames: string[] = [];
	readonly chunkIndexes: number[] = [];

	constructor(private readonly responses: readonly (readonly ReviewFinding[])[]) {}

	async review(
		model: ReviewModelConfiguration,
		_: ReviewInput,
		chunk: ReviewInput["chunks"][number],
		execution?: ReviewExecution,
	): Promise<ReviewModelResult> {
		this.modelNames.push(model.apiName);
		this.chunkIndexes.push(chunk.index);
		execution?.recordUsage({
			stage: "review",
			callId: `${this.id}-review-${chunk.index}`,
			stepNumber: 0,
			usage: REVIEW_USAGE,
		});
		return {
			findings: this.responses[chunk.index - 1] ?? [],
			investigation: {
				kind: "available",
				exchanges: [
					{
						tool: "read_file",
						argumentsJson: JSON.stringify({
							path: `caller-${chunk.index}.ts`,
							ref: HEAD_SHA,
						}),
						responseJson: JSON.stringify({
							content: [{ type: "text", text: `validated caller ${chunk.index}` }],
						}),
					},
				],
			},
			usage: REVIEW_USAGE,
		};
	}
}

class FailingModel implements ReviewModel {
	async review(): Promise<never> {
		throw new ReviewModelResponseError("schema_invalid");
	}
}

class RecordedJudge implements ReviewFindingJudge {
	readonly id = randomUUID();
	readonly batches: ReviewFindingJudgeInput[] = [];

	constructor(
		private readonly decide: (
			batch: ReviewFindingJudgeInput,
		) => ReviewFindingJudgmentResult | Promise<ReviewFindingJudgmentResult> = approveAll,
	) {}

	async judge(
		_: ReviewModelConfiguration,
		__: ReviewInput,
		batch: ReviewFindingJudgeInput,
		execution?: ReviewExecution,
	): Promise<ReviewFindingJudgmentResult> {
		this.batches.push(batch);
		const result = await this.decide(batch);
		execution?.recordUsage({
			stage: "judge",
			callId: `${this.id}-judge-${this.batches.length}`,
			stepNumber: 0,
			usage: result.usage,
		});
		return result;
	}
}

class RecordedQueue implements ReviewWorkQueue {
	readonly reviewReportIds: string[] = [];
	readonly reviewRunIds: string[] = [];
	async enqueueReview(id: string): Promise<void> {
		this.reviewRunIds.push(id);
	}

	async enqueueReport(reviewReportId: string): Promise<void> {
		this.reviewReportIds.push(reviewReportId);
	}
}

describe("ReviewRunProcessorService", () => {
	it("yields an expired run slice and resumes only its unfinished units", async () => {
		vi.useFakeTimers();
		const database = createReviewRun();
		try {
			const first = new RecordedModel([[], []]);
			let interruptedSignal: AbortSignal | null = null;
			const model: ReviewModel = {
				async review(model, input, chunk, execution) {
					if (chunk.index === 1) return first.review(model, input, chunk, execution);
					interruptedSignal = execution.signal;
					return new Promise<ReviewModelResult>((_resolve, reject) => {
						execution.signal.addEventListener(
							"abort",
							() => reject(new Error("cancelled")),
							{ once: true },
						);
					});
				},
			};
			const queue = new RecordedQueue();
			const work = new ReviewWorkRepository(database.connection);
			const processor = new ReviewRunProcessorService(
				database.reviewRunRepository,
				new ReadyInputSource(TWO_CHUNK_INPUT),
				model,
				new RecordedJudge(),
				queue,
				LOGGER,
				work,
				new ReviewTelemetryRepository(database.connection),
				{
					unitConcurrency: 1,
					getModelCapacity: async () => ({ inputTokenLimit: 100_000 }),
				},
			);
			const pending = processor.process(REVIEW_RUN_ID);
			await vi.advanceTimersByTimeAsync(30 * 60 * 1_000 + 1);
			await pending;
			expect(interruptedSignal).toMatchObject({ aborted: true });
			expect(readRun(database)).toMatchObject({
				status: "queued",
				inputTokens: 100,
				errorCode: null,
			});
			expect(work.listLeaves(REVIEW_RUN_ID, "review").map((unit) => unit.status)).toEqual([
				"completed",
				"pending",
			]);
			expect(queue.reviewRunIds).toEqual([REVIEW_RUN_ID]);
			expect(queue.reviewReportIds).toEqual([]);
			const resumed = new RecordedModel([[], []]);
			await createProcessor(
				database,
				new ReadyInputSource(TWO_CHUNK_INPUT),
				resumed,
				new RecordedJudge(),
			).process(REVIEW_RUN_ID);
			expect(resumed.chunkIndexes).toEqual([2]);
			expect(readRun(database)).toMatchObject({ status: "completed", inputTokens: 200 });
		} finally {
			database.close();
			vi.useRealTimers();
		}
	});
	it("bounds parallel units and waits for every unit before publishing", async () => {
		const database = createReviewRun();
		let active = 0,
			peak = 0;
		const model: ReviewModel = {
			async review() {
				active++;
				peak = Math.max(peak, active);
				await new Promise<void>((resolve) => setTimeout(resolve, 1));
				active--;
				return {
					findings: [],
					investigation: { kind: "not_enabled" },
					usage: REVIEW_USAGE,
				};
			},
		};
		const original = ONE_CHUNK_INPUT.chunks[0]!;
		const input = {
			...ONE_CHUNK_INPUT,
			chunks: Array.from({ length: 5 }, (_, i) => ({ ...original, index: i + 1, total: 5 })),
		};
		await createProcessor(
			database,
			new ReadyInputSource(input),
			model,
			new RecordedJudge(),
			LOGGER,
			2,
		).process(REVIEW_RUN_ID);
		expect(peak).toBe(2);
		expect(active).toBe(0);
		expect(readRun(database)).toMatchObject({ status: "completed", reviewChunkCount: 5 });
		expect(database.connection.db.select().from(reviewReports).all()).toHaveLength(1);
		database.close();
	});

	it("resumes completed review units after a failed request without paying for them again", async () => {
		const database = createReviewRun();
		const calls: number[] = [];
		const initial: ReviewModel = {
			async review(_model, _input, chunk, execution) {
				calls.push(chunk.index);
				if (chunk.index === 2) throw new Error("unavailable");
				execution.recordUsage({
					stage: "review",
					callId: "first-unit-paid",
					stepNumber: 0,
					usage: REVIEW_USAGE,
				});
				return {
					findings: [VALID_FINDING],
					investigation: { kind: "not_enabled" },
					usage: REVIEW_USAGE,
				};
			},
		};
		await createProcessor(
			database,
			new ReadyInputSource(TWO_CHUNK_INPUT),
			initial,
			new RecordedJudge(),
		).process(REVIEW_RUN_ID);
		expect(readRun(database)).toMatchObject({ status: "failed", inputTokens: 100 });
		expect(database.reviewRunRepository.requeueReviewRun(REVIEW_RUN_ID, "command")).toBe(true);
		const resumed = new RecordedModel([[], []]);
		await createProcessor(
			database,
			new ReadyInputSource(TWO_CHUNK_INPUT),
			resumed,
			new RecordedJudge(),
		).process(REVIEW_RUN_ID);
		expect(calls).toEqual([1, 2]);
		expect(resumed.chunkIndexes).toEqual([2]);
		expect(readRun(database)).toMatchObject({
			status: "completed",
			inputTokens: 200,
			judgeCallCount: 1,
		});
		expect(database.connection.db.select().from(findings).all()).toHaveLength(1);
		database.close();
	});
	it("creates the complete plan atomically and recovers interrupted claims at startup", () => {
		const database = createReviewRun();
		const work = new ReviewWorkRepository(database.connection);
		work.ensurePlan(REVIEW_RUN_ID, "fingerprint");
		database.connection.client.exec(
			"CREATE TRIGGER reject_second_unit BEFORE INSERT ON review_work_units WHEN NEW.ordinal = 1 BEGIN SELECT RAISE(ABORT, 'simulate storage failure'); END;",
		);
		expect(() => work.ensureUnits(REVIEW_RUN_ID, "review", ["one", "two"])).toThrow(
			"simulate storage failure",
		);
		expect(work.listLeaves(REVIEW_RUN_ID, "review")).toEqual([]);
		database.connection.client.exec("DROP TRIGGER reject_second_unit");
		work.ensureUnits(REVIEW_RUN_ID, "review", ["one", "two"]);
		work.claim(work.listLeaves(REVIEW_RUN_ID, "review")[0]!);
		expect(database.reviewRunRepository.claimQueuedReviewRun(REVIEW_RUN_ID)).not.toBeNull();
		expect(database.reviewRunRepository.recoverReviewRuns()).toEqual([REVIEW_RUN_ID]);
		work.resetInterrupted(REVIEW_RUN_ID);
		expect(work.listLeaves(REVIEW_RUN_ID, "review").map((unit) => unit.status)).toEqual([
			"pending",
			"pending",
		]);
		database.close();
	});

	it("deduplicates before approval and persists split usage metrics", async () => {
		const database = createReviewRun();
		const model = new RecordedModel([[VALID_FINDING], [VALID_FINDING]]);
		const judge = new RecordedJudge();
		const inputSource = new ReadyInputSource(TWO_CHUNK_INPUT);
		const processor = createProcessor(database, inputSource, model, judge);

		await processor.process(REVIEW_RUN_ID);

		expect(model.chunkIndexes).toEqual([1, 2]);
		expect(inputSource.githubInstallationAccountLogins).toEqual(["takeat"]);
		expect(judge.batches).toHaveLength(1);
		expect(judge.batches[0]?.candidates).toHaveLength(1);
		expect(judge.batches[0]?.evidence[0]?.investigation).toEqual({
			kind: "available",
			exchanges: [
				{
					tool: "read_file",
					argumentsJson: JSON.stringify({ path: "caller-1.ts", ref: HEAD_SHA }),
					responseJson: JSON.stringify({
						content: [{ type: "text", text: "validated caller 1" }],
					}),
				},
			],
		});
		expect(database.connection.db.select().from(findings).all()).toMatchObject([
			{ judgeVerdict: "approved", includedInReport: true },
		]);
		expect(readRun(database)).toMatchObject({
			status: "completed",
			modelName: "gemini-3.8-flash",
			inputTokens: 200,
			outputTokens: 40,
			cacheTokens: 20,
			costUsdMicros: 21,
			judgeInputTokens: 25,
			judgeOutputTokens: 5,
			judgeCacheTokens: 2,
			judgeCostUsdMicros: 3,
			judgeCallCount: 1,
			reviewChunkCount: 2,
			changedLineCount: 1,
			reviewStrategyVersion: "evidence-investigation-v7",
		});
		database.close();
	});

	it("persists rejected and severity-corrected findings without publishing rejected ones", async () => {
		const database = createReviewRun();
		const corrected = { ...VALID_FINDING, title: "Wrong severity" };
		const judge = new RecordedJudge((_batch) => ({
			judgments: [
				{ index: 0, judgment: { kind: "rejected", rationale: "Not reachable." } },
				{
					index: 1,
					judgment: {
						kind: "severity_changed",
						severity: "medium",
						rationale: "Impact is localized.",
					},
				},
			],
			usage: JUDGE_USAGE,
		}));
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[VALID_FINDING, corrected]]),
			judge,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(database.connection.db.select().from(findings).all()).toMatchObject([
			{ judgeVerdict: "rejected", judgeSeverity: null, includedInReport: false },
			{
				judgeVerdict: "severity_changed",
				judgeSeverity: "medium",
				includedInReport: true,
			},
		]);
		database.close();
	});

	it("compacts candidates from multiple chunks into one deterministic judge batch", async () => {
		const database = createReviewRun();
		const first = { ...VALID_FINDING, title: "First chunk failure" };
		const second = { ...VALID_FINDING, title: "Second chunk failure" };
		const judge = new RecordedJudge();
		const processor = createProcessor(
			database,
			new ReadyInputSource(TWO_CHUNK_INPUT),
			new RecordedModel([[first], [second]]),
			judge,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(judge.batches).toHaveLength(1);
		expect(judge.batches[0]?.candidates.map((candidate) => candidate.finding.title)).toEqual([
			"First chunk failure",
			"Second chunk failure",
		]);
		expect(readRun(database)).toMatchObject({
			status: "completed",
			judgeCallCount: 1,
			reviewStrategyVersion: "evidence-investigation-v7",
		});
		database.close();
	});

	it("sums judge usage across batches without evaluating a candidate twice", async () => {
		const database = createReviewRun();
		const candidates = Array.from({ length: 51 }, (_, index) => ({
			...VALID_FINDING,
			title: `Failure ${index}`,
		}));
		const judge = new RecordedJudge();
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([candidates]),
			judge,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(judge.batches.map((batch) => batch.candidates.length)).toEqual([50, 1]);
		expect(
			new Set(
				judge.batches.flatMap((batch) =>
					batch.candidates.map((candidate) => candidate.finding.title),
				),
			).size,
		).toBe(51);
		expect(database.connection.db.select().from(findings).all()).toHaveLength(51);
		expect(readRun(database)).toMatchObject({
			judgeCallCount: 2,
			judgeInputTokens: 50,
			judgeOutputTokens: 10,
			judgeCacheTokens: 4,
			judgeCostUsdMicros: 5,
		});
		database.close();
	});

	it("does not call the judge when no candidates exist", async () => {
		const database = createReviewRun();
		const judge = new RecordedJudge();
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[]]),
			judge,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(judge.batches).toEqual([]);
		expect(readRun(database)).toMatchObject({ status: "completed", judgeCallCount: 0 });
		database.close();
	});

	it("splits an oversized judge packet into complete candidates and keeps original findings", async () => {
		const database = createReviewRun();
		const titles = ["First failure", "Second failure", "Third failure"];
		const batchSizes: number[] = [];
		const judge: ReviewFindingJudge = {
			async judge(_model, _input, batch, execution) {
				batchSizes.push(batch.candidates.length);
				if (batch.candidates.length > 1) {
					throw new ReviewContextCapacityExceeded({
						inputTokens: 1_001,
						inputTokenLimit: 1_000,
					});
				}
				execution.recordUsage({
					stage: "judge",
					callId: `judge-${batchSizes.length}`,
					stepNumber: 0,
					usage: JUDGE_USAGE,
				});
				return approveAll(batch);
			},
		};
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([titles.map((title) => ({ ...VALID_FINDING, title }))]),
			judge,
		);
		await processor.process(REVIEW_RUN_ID);
		expect(batchSizes).toEqual([3, 2, 1, 1, 1]);
		expect(
			database.connection.db
				.select()
				.from(findings)
				.all()
				.map((finding) => finding.title),
		).toEqual(titles);
		expect(readRun(database)).toMatchObject({
			status: "completed",
			judgeCallCount: 3,
			judgeInputTokens: 75,
			judgeCostUsdMicros: 8,
		});
		database.close();
	});

	it("fails explicitly when an indivisible context exceeds the model capacity", async () => {
		const database = createReviewRun();
		const model: ReviewModel = {
			async review() {
				throw new ReviewContextCapacityExceeded({
					inputTokens: 1_001,
					inputTokenLimit: 1_000,
				});
			},
		};
		await createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			model,
			new RecordedJudge(),
		).process(REVIEW_RUN_ID);
		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "review_context_capacity_exceeded",
			inputTokens: null,
			costUsdMicros: null,
		});
		expect(database.connection.db.select().from(reviewReports).all()).toEqual([]);
		database.close();
	});

	it("aborts a stalled run at its deadline and persists charged usage exactly once", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const database = createReviewRun();
		let requestSignal: AbortSignal | undefined;
		const model: ReviewModel = {
			async review(_model, _input, _chunk, execution) {
				requestSignal = execution.signal;
				const usage = {
					stage: "review",
					callId: "charged-call",
					stepNumber: 0,
					usage: REVIEW_USAGE,
				} as const;
				execution.recordUsage(usage);
				execution.recordUsage(usage);
				return new Promise<never>((_resolve, reject) =>
					execution.signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					}),
				);
			},
		};
		try {
			const processing = createProcessor(
				database,
				new ReadyInputSource(ONE_CHUNK_INPUT),
				model,
				new RecordedJudge(),
			).process(REVIEW_RUN_ID);
			await vi.waitFor(() => expect(requestSignal).toBeDefined());
			await vi.advanceTimersByTimeAsync(30 * 60 * 1_000 + 1);
			await processing;
			expect(requestSignal?.aborted).toBe(true);
			expect(readRun(database)).toMatchObject({
				status: "queued",
				inputTokens: 100,
				costUsdMicros: 11,
				judgeInputTokens: null,
			});
			expect(database.connection.db.select().from(reviewReports).all()).toEqual([]);
		} finally {
			vi.useRealTimers();
			database.close();
		}
	});

	it("fails closed when the judge response does not cover every candidate", async () => {
		const database = createReviewRun();
		const judge = new RecordedJudge(() => ({ judgments: [], usage: JUDGE_USAGE }));
		const logger = pino({ level: "silent" });
		const warn = vi.spyOn(logger, "warn");
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[VALID_FINDING]]),
			judge,
			logger,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_judge_invalid_response",
			inputTokens: 100,
			costUsdMicros: 11,
			judgeInputTokens: 25,
			judgeCostUsdMicros: 3,
		});
		expect(database.connection.db.select().from(findings).all()).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			{
				candidateCount: 1,
				judgmentCount: 0,
				modelName: "gemini-3.8-flash",
				reason: "coverage_mismatch",
				reviewRunId: REVIEW_RUN_ID,
			},
			"gemini_judge.invalid_response",
		);
		database.close();
	});

	it("fails closed when the judge request fails", async () => {
		const database = createReviewRun();
		const judge = new RecordedJudge(() => Promise.reject(new Error("network")));
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[VALID_FINDING]]),
			judge,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_judge_request_failed",
			inputTokens: 100,
			costUsdMicros: 11,
			judgeInputTokens: null,
			judgeCostUsdMicros: null,
		});
		expect(database.connection.db.select().from(findings).all()).toEqual([]);
		database.close();
	});

	it("retains charged usage across failed attempts and an authorized retry", async () => {
		const database = createReviewRun();
		await createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[VALID_FINDING]]),
			new RecordedJudge(() => ({ judgments: [], usage: JUDGE_USAGE })),
		).process(REVIEW_RUN_ID);
		expect(readRun(database)).toMatchObject({
			status: "failed",
			inputTokens: 100,
			judgeInputTokens: 25,
		});
		expect(database.reviewRunRepository.requeueReviewRun(REVIEW_RUN_ID, "command")).toBe(true);
		expect(readRun(database)).toMatchObject({
			status: "queued",
			inputTokens: 100,
			judgeInputTokens: 25,
		});
		await createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[VALID_FINDING]]),
			new RecordedJudge(),
		).process(REVIEW_RUN_ID);
		expect(readRun(database)).toMatchObject({
			status: "completed",
			inputTokens: 100,
			costUsdMicros: 11,
			judgeInputTokens: 50,
			judgeCostUsdMicros: 5,
			judgeCallCount: 2,
		});
		expect(database.connection.db.select().from(reviewReports).all()).toHaveLength(1);
		database.close();
	});

	it("logs a sanitized judge schema failure reason", async () => {
		const database = createReviewRun();
		const logger = pino({ level: "silent" });
		const warn = vi.spyOn(logger, "warn");
		const judge = new RecordedJudge(() =>
			Promise.reject(new ReviewModelResponseError("schema_invalid")),
		);
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[VALID_FINDING]]),
			judge,
			logger,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_judge_invalid_response",
		});
		expect(warn).toHaveBeenCalledWith(
			{
				candidateCount: 1,
				modelName: "gemini-3.8-flash",
				reason: "schema_invalid",
				reviewRunId: REVIEW_RUN_ID,
			},
			"gemini_judge.invalid_response",
		);
		database.close();
	});

	it("rejects a severity change that keeps the original severity", async () => {
		const database = createReviewRun();
		const logger = pino({ level: "silent" });
		const warn = vi.spyOn(logger, "warn");
		const judge = new RecordedJudge((batch) =>
			judgeAll(batch, {
				kind: "severity_changed",
				severity: "high",
				rationale: "Unchanged.",
			}),
		);
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[VALID_FINDING]]),
			judge,
			logger,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_judge_invalid_response",
		});
		expect(warn).toHaveBeenCalledWith(
			{
				candidateCount: 1,
				judgmentCount: 1,
				modelName: "gemini-3.8-flash",
				reason: "unchanged_severity",
				reviewRunId: REVIEW_RUN_ID,
			},
			"gemini_judge.invalid_response",
		);
		database.close();
	});

	it("stops later chunks and judging without partial persistence after an invalid location", async () => {
		const database = createReviewRun();
		const invalidFinding = { ...VALID_FINDING, line: 99 };
		const model = new RecordedModel([[VALID_FINDING], [invalidFinding], [VALID_FINDING]]);
		const judge = new RecordedJudge();
		const input: ReviewInput = {
			...ONE_CHUNK_INPUT,
			chunks: [1, 2, 3].map((index) => ({ ...ONE_CHUNK_INPUT.chunks[0]!, index, total: 3 })),
		};
		const processor = createProcessor(database, new ReadyInputSource(input), model, judge);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "finding_location_invalid",
			inputTokens: 200,
			costUsdMicros: 21,
		});
		expect(database.connection.db.select().from(findings).all()).toEqual([]);
		expect(model.chunkIndexes).toEqual([1, 2]);
		expect(judge.batches).toEqual([]);
		database.close();
	});

	it("maps an invalid reviewer response to a sanitized error", async () => {
		const database = createReviewRun();
		const logger = pino({ enabled: false });
		const info = vi.spyOn(logger, "info");
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new FailingModel(),
			new RecordedJudge(),
			logger,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_invalid_response",
		});
		expect(info.mock.calls.filter((call) => call[1] === "review_run.stage_finished")).toEqual([
			[
				{
					reviewRunId: REVIEW_RUN_ID,
					stage: "context_load",
					durationMs: expect.any(Number),
					outcome: "completed",
				},
				"review_run.stage_finished",
			],
			[
				{
					reviewRunId: REVIEW_RUN_ID,
					stage: "candidate_generation",
					durationMs: expect.any(Number),
					outcome: "failed",
				},
				"review_run.stage_finished",
			],
		]);
		database.close();
	});

	it.each([
		{
			result: { kind: "ignored", ignoreReason: "superseded_head_sha" },
			stored: { status: "ignored", ignoreReason: "superseded_head_sha" },
		},
		{
			result: { kind: "failed", errorCode: "github_diff_unavailable" },
			stored: { status: "failed", errorCode: "github_diff_unavailable" },
		},
	] as const)(
		"records $result.kind context without calling the model",
		async ({ result, stored }) => {
			const database = createReviewRun();
			const model = new RecordedModel([]);
			const logger = pino({ enabled: false });
			const info = vi.spyOn(logger, "info");
			const processor = createProcessor(
				database,
				new StoppedInputSource(result),
				model,
				new RecordedJudge(),
				logger,
			);

			await processor.process(REVIEW_RUN_ID);

			expect(model.chunkIndexes).toEqual([]);
			expect(readRun(database)).toMatchObject(stored);
			expect(info).toHaveBeenCalledWith(
				{
					reviewRunId: REVIEW_RUN_ID,
					stage: "context_load",
					durationMs: expect.any(Number),
					outcome: result.kind,
				},
				"review_run.stage_finished",
			);
			database.close();
		},
	);
});

function approveAll(batch: ReviewFindingJudgeInput): ReviewFindingJudgmentResult {
	return judgeAll(batch, { kind: "approved", rationale: "Confirmed." });
}

function judgeAll(
	batch: ReviewFindingJudgeInput,
	judgment: FindingJudgment,
): ReviewFindingJudgmentResult {
	return {
		judgments: batch.candidates.map((candidate) => ({ index: candidate.index, judgment })),
		usage: JUDGE_USAGE,
	};
}

function createProcessor(
	database: TestDatabase,
	inputSource: ReviewInputSource,
	model: ReviewModel,
	judge: ReviewFindingJudge,
	logger: Logger = LOGGER,
	unitConcurrency = 1,
): ReviewRunProcessorService {
	return new ReviewRunProcessorService(
		database.reviewRunRepository,
		inputSource,
		model,
		judge,
		new RecordedQueue(),
		logger,
		new ReviewWorkRepository(database.connection),
		new ReviewTelemetryRepository(database.connection),
		{ unitConcurrency, getModelCapacity: async () => ({ inputTokenLimit: 100000 }) },
	);
}

function createReviewRun() {
	const database = createTestDatabase();
	database.githubAccessRepository.upsertInstallation({
		githubInstallationId: 10,
		accountLogin: "takeat",
		status: "active",
	});
	database.githubAccessRepository.upsertRepository({
		githubRepositoryId: 20,
		installationId: 10,
		ownerLogin: "takeat",
		name: "codekeat",
		defaultBranch: "main",
		status: "active",
	});
	database.reviewRunRepository.createReviewRun({
		id: REVIEW_RUN_ID,
		githubRepositoryId: 20,
		pullRequestNumber: 30,
		headSha: HEAD_SHA,
		trigger: "opened",
		status: "queued",
		policyJson: '{"enabled":true,"version":1}',
		policySource: "default",
		policyWarningCode: null,
		ignoreReason: null,
		model: {
			...database.selectedModel,
			inputNanoUsdPerToken: 100,
			cachedInputNanoUsdPerToken: 50,
			outputNanoUsdPerToken: 50,
		},
	});
	return database;
}

function readRun(database: TestDatabase) {
	const run = database.connection.db.select().from(reviewRuns).get();
	if (run === undefined) {
		throw new Error("Review run is missing.");
	}
	return run;
}

const VALID_FINDING: ReviewFinding = {
	severity: "high",
	path: "src/example.ts",
	line: 2,
	title: "A concrete problem",
	rationale: "The added line needs a concrete correction.",
};

const DIFF = [
	"diff --git a/src/example.ts b/src/example.ts",
	"--- a/src/example.ts",
	"+++ b/src/example.ts",
	"@@ -1,1 +1,2 @@",
	" old",
	"+new",
	"",
].join("\n");

const ONE_CHUNK_INPUT: ReviewInput = {
	baseSha: "base-sha",
	repositoryContext: {
		repositoryFullName: "takeat/codekeat",
		revision: HEAD_SHA,
		files: [],
		omittedFileCount: 0,
	},
	body: null,
	chunks: [
		{
			changedLines: new Map([["src/example.ts", new Set([2])]]),
			diff: DIFF,
			referenceBefore: "",
			referenceAfter: "",
			index: 1,
			total: 1,
		},
	],
	headSha: HEAD_SHA,
	githubInstallationAccountLogin: "TakeatGD",
	pullRequestNumber: 30,
	repositoryFullName: "takeat/codekeat",
	reviewRunId: REVIEW_RUN_ID,
	title: "Review input",
};

const TWO_CHUNK_INPUT: ReviewInput = {
	...ONE_CHUNK_INPUT,
	chunks: [
		{ ...ONE_CHUNK_INPUT.chunks[0]!, index: 1, total: 2 },
		{ ...ONE_CHUNK_INPUT.chunks[0]!, index: 2, total: 2 },
	],
};
