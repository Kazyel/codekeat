import { reviewRuns } from "@codekeat/database";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";

import {
	createReviewQualityController,
	createReviewReadController,
	createReviewUsageController,
	type ReviewTokenUsage,
	type StoredFinding,
} from "#features/review";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

describe("createReviewReadController", () => {
	it("requires the internal token and returns run summaries and details", async () => {
		const database = createTestDatabase();
		const reviewRunId = randomUUID();
		prepareReviewRun(database, reviewRunId);
		completeReview(database, reviewRunId, {
			inputTokens: 1_200,
			outputTokens: 300,
			cacheTokens: 200,
			costUsdMicros: 2_345,
		});
		database.connection.db
			.update(reviewRuns)
			.set({ completedAt: "2026-09-03T14:30:00.000Z" })
			.where(eq(reviewRuns.id, reviewRunId))
			.run();
		const server = createServer((request, response) => {
			if (
				!createReviewReadController(database.reviewQueryRepository, "internal-token")(
					request,
					response,
				)
			) {
				response.writeHead(404).end();
			}
		});
		await listen(server);
		const baseUrl = `http://127.0.0.1:${port(server)}`;

		const unauthorized = await fetch(`${baseUrl}/api/v1/review-runs`);
		const list = await fetch(`${baseUrl}/api/v1/review-runs`, {
			headers: { authorization: "Bearer internal-token" },
		});
		const detail = await fetch(`${baseUrl}/api/v1/review-runs/${reviewRunId}`, {
			headers: { authorization: "Bearer internal-token" },
		});

		expect(unauthorized.status).toBe(401);
		expect(await list.json()).toMatchObject({
			reviewRuns: [
				{
					id: reviewRunId,
					completedAt: "2026-09-03T14:30:00.000Z",
					usage: {
						inputTokens: 1_200,
						outputTokens: 300,
						cacheTokens: 200,
						costUsdMicros: 2_345,
					},
				},
			],
		});
		expect(await detail.json()).toMatchObject({
			reviewRun: {
				id: reviewRunId,
				findingCount: 0,
				completedAt: "2026-09-03T14:30:00.000Z",
				usage: {
					inputTokens: 1_200,
					outputTokens: 300,
					cacheTokens: 200,
					costUsdMicros: 2_345,
				},
			},
		});
		await close(server);
		database.close();
	});

	it("aggregates review and judge usage by day, week, and month with repository filtering", async () => {
		const database = createTestDatabase();
		const firstReviewRunId = randomUUID();
		const secondReviewRunId = randomUUID();
		prepareReviewRun(database, firstReviewRunId, 30);
		prepareReviewRun(database, secondReviewRunId, 31);
		completeReview(database, firstReviewRunId, {
			inputTokens: 100,
			outputTokens: 20,
			cacheTokens: 10,
			costUsdMicros: 100,
		});
		completeReview(database, secondReviewRunId, {
			inputTokens: 200,
			outputTokens: 40,
			cacheTokens: 20,
			costUsdMicros: 200,
		});
		database.connection.db
			.update(reviewRuns)
			.set({ completedAt: "2026-01-31T12:00:00.000Z" })
			.where(eq(reviewRuns.id, firstReviewRunId))
			.run();
		database.connection.db
			.update(reviewRuns)
			.set({ completedAt: "2026-02-01T12:00:00.000Z" })
			.where(eq(reviewRuns.id, secondReviewRunId))
			.run();

		const server = createServer((request, response) => {
			if (
				!createReviewUsageController(database.reviewQueryRepository, "internal-token")(
					request,
					response,
				)
			) {
				response.writeHead(404).end();
			}
		});
		await listen(server);
		const baseUrl = `http://127.0.0.1:${port(server)}`;
		const headers = { authorization: "Bearer internal-token" };

		const day = await fetch(`${baseUrl}/api/v1/review-usage?groupBy=day`, { headers });
		const week = await fetch(`${baseUrl}/api/v1/review-usage?groupBy=week`, { headers });
		const month = await fetch(`${baseUrl}/api/v1/review-usage?groupBy=month`, { headers });
		const filtered = await fetch(
			`${baseUrl}/api/v1/review-usage?groupBy=day&repository=takeat/other`,
			{ headers },
		);
		const invalid = await fetch(`${baseUrl}/api/v1/review-usage?groupBy=year`, { headers });

		expect(await day.json()).toEqual({
			usage: [
				{
					period: "2026-01-31",
					repositoryFullName: "takeat/codekeat",
					inputTokens: 110,
					outputTokens: 22,
					cacheTokens: 11,
					costUsdMicros: 110,
				},
				{
					period: "2026-02-01",
					repositoryFullName: "takeat/codekeat",
					inputTokens: 210,
					outputTokens: 42,
					cacheTokens: 21,
					costUsdMicros: 210,
				},
			],
		});
		expect(await week.json()).toEqual({
			usage: [
				{
					period: "2026-01-26",
					repositoryFullName: "takeat/codekeat",
					inputTokens: 320,
					outputTokens: 64,
					cacheTokens: 32,
					costUsdMicros: 320,
				},
			],
		});
		expect(await month.json()).toMatchObject({
			usage: [{ period: "2026-01" }, { period: "2026-02" }],
		});
		expect(await filtered.json()).toEqual({ usage: [] });
		expect(invalid.status).toBe(400);

		await close(server);
		database.close();
	});

	it("includes known failed and ignored usage with legacy reviews without judge usage", async () => {
		const database = createTestDatabase();
		const legacyRunId = randomUUID();
		const failedRunId = randomUUID();
		const unknownUsageRunId = randomUUID();
		const ignoredRunId = randomUUID();
		const unknownIgnoredRunId = randomUUID();
		prepareReviewRun(database, legacyRunId, 30);
		prepareReviewRun(database, failedRunId, 31);
		prepareReviewRun(database, unknownUsageRunId, 32);
		prepareReviewRun(database, ignoredRunId, 33);
		prepareReviewRun(database, unknownIgnoredRunId, 34);
		completeReview(database, legacyRunId, {
			inputTokens: 100,
			outputTokens: 20,
			cacheTokens: 10,
			costUsdMicros: 100,
		});
		database.connection.db
			.update(reviewRuns)
			.set({
				completedAt: "2026-09-03T14:30:00.000Z",
				judgeInputTokens: null,
				judgeOutputTokens: null,
				judgeCacheTokens: null,
				judgeCostUsdMicros: null,
			})
			.where(eq(reviewRuns.id, legacyRunId))
			.run();
		database.connection.db
			.update(reviewRuns)
			.set({
				status: "failed",
				completedAt: "2026-09-03T15:00:00.000Z",
				inputTokens: 50,
				outputTokens: 10,
				cacheTokens: 5,
				costUsdMicros: 50,
				judgeInputTokens: 25,
				judgeOutputTokens: 5,
				judgeCacheTokens: 2,
				judgeCostUsdMicros: 25,
			})
			.where(eq(reviewRuns.id, failedRunId))
			.run();
		database.connection.db
			.update(reviewRuns)
			.set({ status: "failed", completedAt: "2026-09-04T15:00:00.000Z" })
			.where(eq(reviewRuns.id, unknownUsageRunId))
			.run();
		database.connection.db
			.update(reviewRuns)
			.set({
				status: "ignored",
				completedAt: "2026-09-03T16:00:00.000Z",
				inputTokens: 25,
				outputTokens: 5,
				cacheTokens: 2,
				costUsdMicros: 25,
				judgeInputTokens: 5,
				judgeOutputTokens: 1,
				judgeCacheTokens: 0,
				judgeCostUsdMicros: 5,
			})
			.where(eq(reviewRuns.id, ignoredRunId))
			.run();
		database.connection.db
			.update(reviewRuns)
			.set({ status: "ignored", completedAt: "2026-09-05T15:00:00.000Z" })
			.where(eq(reviewRuns.id, unknownIgnoredRunId))
			.run();
		const server = createServer((request, response) => {
			if (
				!createReviewUsageController(database.reviewQueryRepository, "internal-token")(
					request,
					response,
				)
			) {
				response.writeHead(404).end();
			}
		});
		await listen(server);
		try {
			const response = await fetch(
				`http://127.0.0.1:${port(server)}/api/v1/review-usage?groupBy=day`,
				{ headers: { authorization: "Bearer internal-token" } },
			);
			expect(await response.json()).toEqual({
				usage: [
					{
						period: "2026-09-03",
						repositoryFullName: "takeat/codekeat",
						inputTokens: 205,
						outputTokens: 41,
						cacheTokens: 19,
						costUsdMicros: 205,
					},
				],
			});
		} finally {
			await close(server);
			database.close();
		}
	});

	it("aggregates judge quality without multiplying run usage by findings", async () => {
		const database = createTestDatabase();
		const reviewRunId = randomUUID();
		prepareReviewRun(database, reviewRunId);
		database.reviewRunRepository.completeReviewRun(reviewRunId, {
			reviewUsage: {
				inputTokens: 100,
				outputTokens: 20,
				cacheTokens: 10,
				costUsdMicros: 100,
			},
			judgeUsage: {
				inputTokens: 50,
				outputTokens: 10,
				cacheTokens: 5,
				costUsdMicros: 50,
			},
			findings: [
				createStoredFinding("approved", true, "finding-1"),
				createStoredFinding("rejected", false, "finding-2"),
			],
			reviewReportId: randomUUID(),
			reviewStrategyVersion: "judge-gate-v1",
			changedLineCount: 20,
			reviewChunkCount: 1,
			judgeCallCount: 1,
			processingDurationMs: 120,
		});
		database.connection.db
			.update(reviewRuns)
			.set({ completedAt: "2026-09-03T14:30:00.000Z" })
			.where(eq(reviewRuns.id, reviewRunId))
			.run();
		const server = createServer((request, response) => {
			if (
				!createReviewQualityController(database.reviewQueryRepository, "internal-token")(
					request,
					response,
				)
			) {
				response.writeHead(404).end();
			}
		});
		await listen(server);

		const response = await fetch(
			`http://127.0.0.1:${port(server)}/api/v1/review-quality?groupBy=month`,
			{ headers: { authorization: "Bearer internal-token" } },
		);

		expect(await response.json()).toEqual({
			quality: [
				{
					period: "2026-09",
					repositoryFullName: "takeat/codekeat",
					reviewStrategyVersion: "judge-gate-v1",
					evaluatedFindingCount: 2,
					approvedFindingCount: 1,
					rejectedFindingCount: 1,
					severityChangedFindingCount: 0,
					acceptedFindingCount: 1,
					judgeApprovalRateBasisPoints: 5_000,
					acceptedFindingsPerThousandChangedLines: 50,
					changedLineCount: 20,
					completedRunCount: 1,
					reviewInputTokens: 100,
					reviewOutputTokens: 20,
					reviewCacheTokens: 10,
					reviewCostUsdMicros: 100,
					judgeInputTokens: 50,
					judgeOutputTokens: 10,
					judgeCacheTokens: 5,
					judgeCostUsdMicros: 50,
					judgeCallCount: 1,
					averageProcessingDurationMs: 120,
				},
			],
		});
		await close(server);
		database.close();
	});
});

function completeReview(
	database: TestDatabase,
	reviewRunId: string,
	reviewUsage: ReviewTokenUsage,
): void {
	database.reviewRunRepository.completeReviewRun(reviewRunId, {
		reviewUsage,
		judgeUsage: { inputTokens: 10, outputTokens: 2, cacheTokens: 1, costUsdMicros: 10 },
		findings: [],
		reviewReportId: randomUUID(),
		reviewStrategyVersion: "judge-gate-v1",
		changedLineCount: 10,
		reviewChunkCount: 1,
		judgeCallCount: 0,
		processingDurationMs: 100,
	});
}

function createStoredFinding(
	judgeVerdict: "approved" | "rejected",
	includedInReport: boolean,
	id: string,
): StoredFinding {
	return {
		id,
		severity: "high",
		path: "src/example.ts",
		line: 2,
		title: id,
		rationale: "Concrete rationale.",
		judgeVerdict,
		judgeSeverity: null,
		judgeRationale: "Judged.",
		includedInReport,
	};
}

function prepareReviewRun(
	database: TestDatabase,
	reviewRunId: string,
	pullRequestNumber = 30,
): void {
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
		id: reviewRunId,
		githubRepositoryId: 20,
		pullRequestNumber,
		headSha: pullRequestNumber.toString(16).padStart(40, "0"),
		trigger: "opened",
		status: "queued",
		policyJson: '{"enabled":true,"version":1}',
		policySource: "default",
		policyWarningCode: null,
		ignoreReason: null,
		model: database.selectedModel,
	});
}

async function listen(server: Server): Promise<void> {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
}

function port(server: Server): number {
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("HTTP server address is unavailable.");
	}
	return address.port;
}

async function close(server: Server): Promise<void> {
	server.close();
	await once(server, "close");
}
