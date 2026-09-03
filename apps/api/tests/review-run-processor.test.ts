import { findings, reviewRuns } from "@codekeat/database";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { ReviewModelConfiguration } from "#features/models";

import {
	type FindingJudgment,
	type ReviewFinding,
	type ReviewFindingJudge,
	type ReviewFindingJudgeInput,
	type ReviewFindingJudgmentResult,
	type ReviewInput,
	type ReviewInputLoadResult,
	type ReviewInputSource,
	type ReviewModel,
	ReviewModelResponseError,
	type ReviewModelResult,
	ReviewRunProcessorService,
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
	costUsdMicros: 10.25,
};
const JUDGE_USAGE = {
	inputTokens: 25,
	outputTokens: 5,
	cacheTokens: 2,
	costUsdMicros: 3.4,
};

class ReadyInputSource implements ReviewInputSource {
	readonly githubInstallationAccountLogins: string[] = [];

	constructor(private readonly input: ReviewInput) {}

	async load(run: RunnableReviewRun): Promise<ReviewInputLoadResult> {
		this.githubInstallationAccountLogins.push(run.githubInstallationAccountLogin);
		return { kind: "ready", input: this.input };
	}
}

class IgnoredInputSource implements ReviewInputSource {
	async load(): Promise<ReviewInputLoadResult> {
		return { kind: "ignored", ignoreReason: "superseded_head_sha" };
	}
}

class RecordedModel implements ReviewModel {
	readonly modelNames: string[] = [];
	readonly chunkIndexes: number[] = [];

	constructor(private readonly responses: readonly (readonly ReviewFinding[])[]) {}

	async review(
		model: ReviewModelConfiguration,
		_: ReviewInput,
		chunk: ReviewInput["chunks"][number],
	): Promise<ReviewModelResult> {
		this.modelNames.push(model.apiName);
		this.chunkIndexes.push(chunk.index);
		return {
			findings: this.responses[chunk.index - 1] ?? [],
			usage: REVIEW_USAGE,
		};
	}
}

class FailingModel implements ReviewModel {
	async review(): Promise<never> {
		throw new ReviewModelResponseError();
	}
}

class RecordedJudge implements ReviewFindingJudge {
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
	): Promise<ReviewFindingJudgmentResult> {
		this.batches.push(batch);
		return this.decide(batch);
	}
}

class RecordedQueue implements Pick<ReviewWorkQueue, "enqueueReport"> {
	readonly reviewReportIds: string[] = [];

	async enqueueReport(reviewReportId: string): Promise<void> {
		this.reviewReportIds.push(reviewReportId);
	}
}

describe("ReviewRunProcessorService", () => {
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
			reviewStrategyVersion: "compact-judge-v3",
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
			reviewStrategyVersion: "compact-judge-v3",
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
			judgeCostUsdMicros: 7,
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

	it("fails closed when the judge response does not cover every candidate", async () => {
		const database = createReviewRun();
		const judge = new RecordedJudge(() => ({ judgments: [], usage: JUDGE_USAGE }));
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[VALID_FINDING]]),
			judge,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_judge_invalid_response",
		});
		expect(database.connection.db.select().from(findings).all()).toEqual([]);
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
		});
		expect(database.connection.db.select().from(findings).all()).toEqual([]);
		database.close();
	});

	it("rejects a severity change that keeps the original severity", async () => {
		const database = createReviewRun();
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
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_judge_invalid_response",
		});
		database.close();
	});

	it("fails without partial persistence for an invalid finding location", async () => {
		const database = createReviewRun();
		const invalidFinding = { ...VALID_FINDING, line: 99 };
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([[invalidFinding]]),
			new RecordedJudge(),
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "finding_location_invalid",
		});
		expect(database.connection.db.select().from(findings).all()).toEqual([]);
		database.close();
	});

	it("maps an invalid reviewer response to a sanitized error", async () => {
		const database = createReviewRun();
		const processor = createProcessor(
			database,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new FailingModel(),
			new RecordedJudge(),
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_invalid_response",
		});
		database.close();
	});

	it("ignores an outdated head SHA without calling the model", async () => {
		const database = createReviewRun();
		const model = new RecordedModel([]);
		const processor = createProcessor(
			database,
			new IgnoredInputSource(),
			model,
			new RecordedJudge(),
		);

		await processor.process(REVIEW_RUN_ID);

		expect(model.chunkIndexes).toEqual([]);
		expect(readRun(database)).toMatchObject({
			status: "ignored",
			ignoreReason: "superseded_head_sha",
		});
		database.close();
	});
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
): ReviewRunProcessorService {
	return new ReviewRunProcessorService(
		database.reviewRunRepository,
		inputSource,
		model,
		judge,
		new RecordedQueue(),
		LOGGER,
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
		model: database.selectedModel,
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
