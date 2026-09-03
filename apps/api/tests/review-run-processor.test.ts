import { findings, reviewRuns } from "@codekeat/database";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { ReviewModelConfiguration } from "#features/models";

import {
	type ReviewFinding,
	type ReviewInput,
	type ReviewInputSource,
	type ReviewInputLoadResult,
	ReviewModelResponseError,
	type ReviewModel,
	type ReviewModelResult,
	type RunnableReviewRun,
	ReviewRunProcessorService,
	type ReviewWorkQueue,
} from "#features/review";
import { createTestDatabase } from "./test-database.js";

const LOGGER = pino({ enabled: false });
const REVIEW_RUN_ID = "review-run-1";
const HEAD_SHA = "a".repeat(40);

describe("ReviewRunProcessorService", () => {
	it("claims a queued run, processes chunks sequentially, and persists findings", async () => {
		const database = createReviewRun();
		const model = new RecordedModel([VALID_FINDING, VALID_FINDING]);
		const inputSource = new ReadyInputSource(TWO_CHUNK_INPUT);
		const processor = new ReviewRunProcessorService(
			database.reviewRunRepository,
			inputSource,
			model,
			new RecordedQueue(),
			LOGGER,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(model.chunkIndexes).toEqual([1, 2]);
		expect(inputSource.githubInstallationAccountLogins).toEqual(["takeat"]);
		expect(model.modelNames).toEqual(["gemini-3.8-flash", "gemini-3.8-flash"]);
		expect(database.connection.db.select().from(findings).all()).toHaveLength(1);
		expect(readRun(database)).toMatchObject({
			status: "completed",
			modelName: "gemini-3.8-flash",
			inputTokens: 200,
			outputTokens: 40,
			cacheTokens: 20,
			costUsdMicros: 21,
		});
		expect(readRun(database).startedAt).not.toBeNull();
		expect(readRun(database).completedAt).not.toBeNull();
		database.close();
	});

	it("ignores an outdated head SHA without calling the model", async () => {
		const database = createReviewRun();
		const model = new RecordedModel([]);
		const processor = new ReviewRunProcessorService(
			database.reviewRunRepository,
			new IgnoredInputSource(),
			model,
			new RecordedQueue(),
			LOGGER,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(model.chunkIndexes).toEqual([]);
		expect(readRun(database)).toMatchObject({
			status: "ignored",
			ignoreReason: "superseded_head_sha",
		});
		database.close();
	});

	it("fails without partial persistence for an invalid finding location", async () => {
		const database = createReviewRun();
		const invalidFinding = { ...VALID_FINDING, line: 99 };
		const processor = new ReviewRunProcessorService(
			database.reviewRunRepository,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new RecordedModel([invalidFinding]),
			new RecordedQueue(),
			LOGGER,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "finding_location_invalid",
		});
		expect(database.connection.db.select().from(findings).all()).toEqual([]);
		database.close();
	});

	it("fails with a sanitized Gemini response code", async () => {
		const database = createReviewRun();
		const processor = new ReviewRunProcessorService(
			database.reviewRunRepository,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			new FailingModel(),
			new RecordedQueue(),
			LOGGER,
		);

		await processor.process(REVIEW_RUN_ID);

		expect(readRun(database)).toMatchObject({
			status: "failed",
			errorCode: "gemini_invalid_response",
		});
		expect(database.connection.db.select().from(findings).all()).toEqual([]);
		database.close();
	});

	it("does not process an already claimed run twice", async () => {
		const database = createReviewRun();
		const model = new RecordedModel([VALID_FINDING]);
		const processor = new ReviewRunProcessorService(
			database.reviewRunRepository,
			new ReadyInputSource(ONE_CHUNK_INPUT),
			model,
			new RecordedQueue(),
			LOGGER,
		);

		await processor.process(REVIEW_RUN_ID);
		await processor.process(REVIEW_RUN_ID);

		expect(model.chunkIndexes).toEqual([1]);
		database.close();
	});
});

class ReadyInputSource implements ReviewInputSource {
	readonly githubInstallationAccountLogins: string[] = [];

	constructor(private readonly input: ReviewInput) {}

	async load(run: RunnableReviewRun): Promise<ReviewInputLoadResult> {
		this.githubInstallationAccountLogins.push(run.githubInstallationAccountLogin);
		return { kind: "ready" as const, input: this.input };
	}
}

class IgnoredInputSource implements ReviewInputSource {
	async load() {
		return { kind: "ignored" as const, ignoreReason: "superseded_head_sha" as const };
	}
}

class RecordedModel implements ReviewModel {
	readonly modelNames: string[] = [];
	readonly chunkIndexes: number[] = [];

	constructor(private readonly responses: readonly ReviewFinding[]) {}

	async review(
		model: ReviewModelConfiguration,
		_: ReviewInput,
		chunk: ReviewInput["chunks"][number],
	): Promise<ReviewModelResult> {
		this.modelNames.push(model.apiName);
		this.chunkIndexes.push(chunk.index);
		return {
			findings: this.responses,
			usage: {
				inputTokens: 100,
				outputTokens: 20,
				cacheTokens: 10,
				costUsdMicros: 10.25,
			},
		};
	}
}

class FailingModel implements ReviewModel {
	async review(): Promise<never> {
		throw new ReviewModelResponseError();
	}
}

class RecordedQueue implements Pick<ReviewWorkQueue, "enqueueReport"> {
	readonly reviewReportIds: string[] = [];

	async enqueueReport(reviewReportId: string): Promise<void> {
		this.reviewReportIds.push(reviewReportId);
	}
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

function readRun(database: ReturnType<typeof createReviewRun>) {
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

const ONE_CHUNK_INPUT: ReviewInput = {
	body: null,
	chunks: [
		{
			changedLines: new Map([["src/example.ts", new Set([2])]]),
			diff: "diff",
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
		{
			changedLines: new Map([["src/example.ts", new Set([2])]]),
			diff: "one",
			index: 1,
			total: 2,
		},
		{
			changedLines: new Map([["src/example.ts", new Set([2])]]),
			diff: "two",
			index: 2,
			total: 2,
		},
	],
};
