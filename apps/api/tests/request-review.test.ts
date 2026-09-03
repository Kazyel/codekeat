import { reviewReports, reviewRuns } from "@codekeat/database";
import { describe, expect, it } from "vitest";

import type { ResolvedRepositoryPolicy } from "#features/repository-policy";
import { type RequestReview, requestReview, type ReviewWorkQueue } from "#features/review";
import { createTestDatabase } from "./test-database.js";

const REVIEW_REQUEST: RequestReview = {
	deliveryId: "delivery-1",
	installationId: 10,
	accountLogin: "takeat",
	repositoryId: 20,
	repositoryOwner: "takeat",
	repositoryName: "codekeat",
	repositoryFullName: "takeat/codekeat",
	repositoryDefaultBranch: "main",
	pullRequestNumber: 30,
	headSha: "a".repeat(40),
	trigger: "opened",
};

describe("requestReview", () => {
	it("persists and queues an enabled review", async () => {
		const database = createTestDatabase();
		prepareActiveRepository(database);
		const queue = new RecordedQueue();

		const result = await requestReview(REVIEW_REQUEST, ENABLED_POLICY, {
			runRepository: database.reviewRunRepository,
			modelRepository: database.modelCatalogRepository,
			reportRepository: database.reviewReportRepository,
			queue,
		});

		const runs = database.connection.db.select().from(reviewRuns).all();
		expect(result.kind).toBe("queued");
		expect(runs).toHaveLength(1);
		expect(runs[0]?.status).toBe("queued");
		expect(runs[0]).toMatchObject({
			modelId: database.selectedModel.id,
			modelName: database.selectedModel.apiName,
			modelInputNanoUsdPerToken: database.selectedModel.inputNanoUsdPerToken,
			modelCachedInputNanoUsdPerToken: database.selectedModel.cachedInputNanoUsdPerToken,
			modelOutputNanoUsdPerToken: database.selectedModel.outputNanoUsdPerToken,
		});
		expect(queue.reviewRunIds).toEqual([runs[0]?.id]);
		database.close();
	});

	it("records an ignored run when the repository policy is disabled", async () => {
		const database = createTestDatabase();
		prepareActiveRepository(database);
		const queue = new RecordedQueue();

		const result = await requestReview(REVIEW_REQUEST, DISABLED_POLICY, {
			runRepository: database.reviewRunRepository,
			modelRepository: database.modelCatalogRepository,
			reportRepository: database.reviewReportRepository,
			queue,
		});

		const runs = database.connection.db.select().from(reviewRuns).all();
		expect(result.kind).toBe("ignored");
		expect(runs[0]?.status).toBe("ignored");
		expect(runs[0]?.ignoreReason).toBe("repository_policy_disabled");
		expect(queue.reviewRunIds).toEqual([]);
		database.close();
	});

	it("deduplicates different deliveries for the same pull request SHA", async () => {
		const database = createTestDatabase();
		prepareActiveRepository(database);
		const queue = new RecordedQueue();
		const dependencies = {
			runRepository: database.reviewRunRepository,
			modelRepository: database.modelCatalogRepository,
			reportRepository: database.reviewReportRepository,
			queue,
		};

		await requestReview(REVIEW_REQUEST, ENABLED_POLICY, dependencies);
		const duplicate = await requestReview(
			{ ...REVIEW_REQUEST, deliveryId: "delivery-2", trigger: "synchronize" },
			ENABLED_POLICY,
			dependencies,
		);

		expect(duplicate.kind).toBe("duplicate");
		expect(database.connection.db.select().from(reviewRuns).all()).toHaveLength(1);
		expect(queue.reviewRunIds).toHaveLength(1);
		database.close();
	});

	it("creates another run for a new pull request SHA", async () => {
		const database = createTestDatabase();
		prepareActiveRepository(database);
		const queue = new RecordedQueue();
		const dependencies = {
			runRepository: database.reviewRunRepository,
			modelRepository: database.modelCatalogRepository,
			reportRepository: database.reviewReportRepository,
			queue,
		};

		await requestReview(REVIEW_REQUEST, ENABLED_POLICY, dependencies);
		await requestReview(
			{ ...REVIEW_REQUEST, deliveryId: "delivery-3", headSha: "b".repeat(40) },
			ENABLED_POLICY,
			dependencies,
		);

		expect(database.connection.db.select().from(reviewRuns).all()).toHaveLength(2);
		expect(queue.reviewRunIds).toHaveLength(2);
		database.close();
	});

	it("persists the invalid policy warning with the default policy", async () => {
		const database = createTestDatabase();
		prepareActiveRepository(database);

		await requestReview(REVIEW_REQUEST, INVALID_POLICY_FALLBACK, {
			runRepository: database.reviewRunRepository,
			modelRepository: database.modelCatalogRepository,
			reportRepository: database.reviewReportRepository,
			queue: new RecordedQueue(),
		});

		const runs = database.connection.db.select().from(reviewRuns).all();
		expect(runs[0]?.policySource).toBe("default");
		expect(runs[0]?.policyWarningCode).toBe("invalid_repository_policy");
		database.close();
	});

	it("reopens a failed run when the repository remains eligible", async () => {
		const database = createTestDatabase();
		prepareActiveRepository(database);
		const queue = new RecordedQueue();
		database.reviewRunRepository.createReviewRun({
			id: "failed-run",
			githubRepositoryId: REVIEW_REQUEST.repositoryId,
			pullRequestNumber: REVIEW_REQUEST.pullRequestNumber,
			headSha: REVIEW_REQUEST.headSha,
			trigger: "opened",
			status: "failed",
			policyJson: '{"enabled":true,"version":1}',
			policySource: "default",
			policyWarningCode: null,
			ignoreReason: null,
			model: database.selectedModel,
		});
		const replacement = database.modelCatalogRepository
			.listModels()
			.find((model) => model.apiName === "gemini-3.7-flash");
		if (replacement === undefined) {
			throw new Error("Replacement model fixture is missing.");
		}
		database.modelCatalogRepository.selectModel(replacement.id);

		const result = await requestReview(
			{ ...REVIEW_REQUEST, trigger: "reopened" },
			ENABLED_POLICY,
			{
				runRepository: database.reviewRunRepository,
				modelRepository: database.modelCatalogRepository,
				reportRepository: database.reviewReportRepository,
				queue,
			},
		);

		expect(result.kind).toBe("queued");
		expect(queue.reviewRunIds).toEqual(["failed-run"]);
		expect(database.connection.db.select().from(reviewRuns).get()?.status).toBe("queued");
		expect(database.connection.db.select().from(reviewRuns).get()?.modelName).toBe(
			"gemini-3.8-flash",
		);
		database.close();
	});

	it("reopens a completed run by scheduling its missing report without Gemini work", async () => {
		const database = createTestDatabase();
		prepareActiveRepository(database);
		const queue = new RecordedQueue();
		database.reviewRunRepository.createReviewRun({
			id: "completed-run",
			githubRepositoryId: REVIEW_REQUEST.repositoryId,
			pullRequestNumber: REVIEW_REQUEST.pullRequestNumber,
			headSha: REVIEW_REQUEST.headSha,
			trigger: "opened",
			status: "queued",
			policyJson: '{"enabled":true,"version":1}',
			policySource: "default",
			policyWarningCode: null,
			ignoreReason: null,
			model: database.selectedModel,
		});
		database.reviewRunRepository.completeReviewRun(
			"completed-run",
			{ inputTokens: 1, outputTokens: 1, cacheTokens: 0, costUsdMicros: 1 },
			[],
			"report-1",
		);

		const result = await requestReview(
			{ ...REVIEW_REQUEST, trigger: "reopened" },
			ENABLED_POLICY,
			{
				runRepository: database.reviewRunRepository,
				modelRepository: database.modelCatalogRepository,
				reportRepository: database.reviewReportRepository,
				queue,
			},
		);

		expect(result.kind).toBe("report_queued");
		expect(queue.reviewRunIds).toEqual([]);
		expect(queue.reviewReportIds).toEqual(["report-1"]);
		expect(database.connection.db.select().from(reviewReports).get()?.status).toBe("pending");
		database.close();
	});
});

class RecordedQueue implements ReviewWorkQueue {
	readonly reviewRunIds: string[] = [];
	readonly reviewReportIds: string[] = [];

	async enqueueReview(reviewRunId: string): Promise<void> {
		this.reviewRunIds.push(reviewRunId);
	}

	async enqueueReport(reviewReportId: string): Promise<void> {
		this.reviewReportIds.push(reviewReportId);
	}
}

function prepareActiveRepository(database: ReturnType<typeof createTestDatabase>): void {
	database.githubAccessRepository.upsertInstallation({
		githubInstallationId: REVIEW_REQUEST.installationId,
		accountLogin: REVIEW_REQUEST.accountLogin,
		status: "active",
	});
	database.githubAccessRepository.upsertRepository({
		githubRepositoryId: REVIEW_REQUEST.repositoryId,
		installationId: REVIEW_REQUEST.installationId,
		ownerLogin: REVIEW_REQUEST.repositoryOwner,
		name: REVIEW_REQUEST.repositoryName,
		defaultBranch: REVIEW_REQUEST.repositoryDefaultBranch,
		status: "active",
	});
}

const ENABLED_POLICY: ResolvedRepositoryPolicy = {
	policy: { version: 1, enabled: true },
	source: "repository",
	warningCode: null,
};

const DISABLED_POLICY: ResolvedRepositoryPolicy = {
	policy: { version: 1, enabled: false },
	source: "repository",
	warningCode: null,
};

const INVALID_POLICY_FALLBACK: ResolvedRepositoryPolicy = {
	policy: { version: 1, enabled: true },
	source: "default",
	warningCode: "invalid_repository_policy",
};
