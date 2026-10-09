import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { reviewTelemetry } from "@codekeat/database";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createReviewTelemetryController } from "../src/features/review/controllers/review-telemetry.controller.js";
import { ReviewTelemetryRepository } from "../src/features/review/repositories/review-telemetry.repository.js";
import {
	createReviewMetric,
	reviewMetricSchema,
	reviewMetricEventSchema,
} from "../src/features/review/types/review-metrics.types.js";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

describe("review telemetry", () => {
	it("persists fractional known cost and keeps unavailable usage unknown", () => {
		const database = createTestDatabase();
		try {
			const runId = createRun(database);
			const repository = new ReviewTelemetryRepository(database.connection);
			repository.record(
				runId,
				createReviewMetric({
					phase: "generation",
					durationMs: 120,
					outcome: "failed",
					callId: "call-provider_1",
					reasoningTokens: 1,
					usage: {
						inputTokens: 10,
						outputTokens: 2,
						cacheTokens: 4,
						costUsdMicros: 0.125,
					},
				}),
			);
			repository.record(
				runId,
				createReviewMetric({ phase: "judge", durationMs: 40, outcome: "cancelled" }),
			);
			expect(repository.findRunEvents(runId)?.events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						phase: "generation",
						outcome: "failed",
						reasoningTokens: 1,
						usage: {
							inputTokens: 10,
							outputTokens: 2,
							cacheTokens: 4,
							costUsdMicros: 0.125,
						},
					}),
					expect.objectContaining({
						phase: "judge",
						outcome: "cancelled",
						usage: null,
						reasoningTokens: null,
					}),
				]),
			);
			expect(() =>
				reviewMetricSchema.parse({
					...createReviewMetric({ phase: "tool", durationMs: 1, outcome: "success" }),
					payload: "private source text",
				}),
			).toThrow(/Unrecognized key/);
		} finally {
			database.close();
		}
	});

	it("computes nearest-rank percentiles by phase, scope and observed size with repository/date filtering", () => {
		const database = createTestDatabase();
		try {
			const repository = new ReviewTelemetryRepository(database.connection);
			const runId = createRun(database);
			repository.record(
				runId,
				createReviewMetric({
					phase: "input",
					scope: "phase",
					durationMs: 1,
					outcome: "success",
					diffBytes: 65_536,
					sourceBytes: 10_000_000,
				}),
			);
			for (const durationMs of [10, 20, 30, 40, 1_000])
				repository.record(
					runId,
					createReviewMetric({
						phase: "generation",
						durationMs,
						outcome: "success",
						sourceBytes: 65_536,
						requestCount: 1,
						reasoningTokens: durationMs === 10 ? 1 : null,
						usage: [10, 20].includes(durationMs)
							? {
									inputTokens: 10,
									outputTokens: 2,
									cacheTokens: 4,
									costUsdMicros: 0.125,
								}
							: null,
					}),
				);
			repository.record(
				runId,
				createReviewMetric({
					phase: "generation",
					scope: "phase",
					durationMs: 2_000,
					outcome: "success",
				}),
			);
			const unknownRunId = createRun(database, 31);
			repository.record(
				unknownRunId,
				createReviewMetric({
					phase: "count",
					durationMs: 3,
					outcome: "failed",
					capacityFailure: true,
				}),
			);
			const mediumRunId = createRun(database, 32);
			repository.record(
				mediumRunId,
				createReviewMetric({
					phase: "input",
					scope: "phase",
					durationMs: 1,
					outcome: "success",
					diffBytes: 65_537,
				}),
			);
			const largeRunId = createRun(database, 33);
			repository.record(
				largeRunId,
				createReviewMetric({
					phase: "input",
					scope: "phase",
					durationMs: 2,
					outcome: "success",
					diffBytes: 524_289,
				}),
			);
			database.connection.db
				.update(reviewTelemetry)
				.set({ createdAt: "2026-09-03T12:00:00.000Z" })
				.run();

			const summaries = repository.listSummaries(
				"day",
				"2026-09-01T00:00:00.000Z",
				"takeat/codekeat",
			);
			expect(summaries).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						phase: "generation",
						scope: "operation",
						sizeBand: "small",
						sampleCount: 5,
						runCount: 1,
						p50DurationMs: 30,
						p95DurationMs: 1_000,
						requestCount: 5,
						knownUsageCount: 2,
						knownReasoningCount: 1,
						reasoningTokens: 1,
						usage: {
							inputTokens: 20,
							outputTokens: 4,
							cacheTokens: 8,
							costUsdMicros: 0.25,
						},
					}),
					expect.objectContaining({
						phase: "generation",
						scope: "phase",
						sizeBand: "small",
						sampleCount: 1,
						p95DurationMs: 2_000,
						knownReasoningCount: 0,
						reasoningTokens: null,
					}),
					expect.objectContaining({
						phase: "count",
						sizeBand: "unknown",
						failureCount: 1,
						capacityFailureCount: 1,
					}),
					expect.objectContaining({ phase: "input", sizeBand: "medium" }),
					expect.objectContaining({ phase: "input", sizeBand: "large" }),
				]),
			);
			expect(repository.listSummaries("day", "2026-09-04T00:00:00.000Z")).toEqual([]);
			expect(
				repository.listSummaries("day", "2026-09-01T00:00:00.000Z", "takeat/other"),
			).toEqual([]);
			expect(repository.listSummaries("week", "2026-09-01T00:00:00.000Z")[0]?.period).toBe(
				"2026-08-31",
			);
			expect(repository.listSummaries("month", "2026-09-01T00:00:00.000Z")[0]?.period).toBe(
				"2026-09",
			);
		} finally {
			database.close();
		}
	});

	it("requires authentication and validates the query and run ID at the HTTP boundary", async () => {
		const database = createTestDatabase();
		const repository = new ReviewTelemetryRepository(database.connection);
		const runId = createRun(database);
		repository.record(
			runId,
			createReviewMetric({
				phase: "queue",
				scope: "phase",
				durationMs: 12,
				outcome: "success",
			}),
		);
		const controller = createReviewTelemetryController(repository, "internal-token");
		const server = createServer((request, response) => {
			if (!controller(request, response)) response.writeHead(404).end();
		});
		await listen(server);
		try {
			const base = `http://127.0.0.1:${port(server)}/api/v1/review-telemetry`;
			const headers = { authorization: "Bearer internal-token" };
			expect((await fetch(base)).status).toBe(401);
			expect((await fetch(`${base}?days=91`, { headers })).status).toBe(400);
			expect((await fetch(`${base}?payload=secret`, { headers })).status).toBe(400);
			expect((await fetch(`${base}/${randomUUID()}`, { headers })).status).toBe(404);
			expect((await fetch(`${base}/invalid`, { headers })).status).toBe(404);
			expect(await (await fetch(`${base}/${runId}`, { headers })).json()).toMatchObject({
				events: [{ phase: "queue", durationMs: 12, reasoningTokens: null }],
			});
			expect(await (await fetch(base, { headers })).json()).toMatchObject({
				days: 30,
				summaries: [
					{
						phase: "queue",
						sampleCount: 1,
						knownReasoningCount: 0,
						reasoningTokens: null,
					},
				],
			});
			database.connection.db
				.delete(reviewTelemetry)
				.where(eq(reviewTelemetry.reviewRunId, runId))
				.run();
			expect(await (await fetch(`${base}/${runId}`, { headers })).json()).toEqual({
				events: [],
				nextCursor: null,
			});
		} finally {
			server.close();
			await once(server, "close");
			database.close();
		}
	});

	it("paginates all events exactly once when timestamps tie and rejects malformed pagination", async () => {
		const database = createTestDatabase();
		const repository = new ReviewTelemetryRepository(database.connection);
		const runId = createRun(database);
		for (let index = 0; index < 501; index++)
			repository.record(
				runId,
				createReviewMetric({ phase: "tool", durationMs: index, outcome: "success" }),
			);
		database.connection.db
			.update(reviewTelemetry)
			.set({ createdAt: "2026-09-03T12:00:00.000Z" })
			.run();
		const controller = createReviewTelemetryController(repository, "internal-token");
		const server = createServer((request, response) => {
			if (!controller(request, response)) response.writeHead(404).end();
		});
		await listen(server);
		try {
			const base = `http://127.0.0.1:${port(server)}/api/v1/review-telemetry/${runId}`;
			const headers = { authorization: "Bearer internal-token" };
			const pageSchema = z.object({
				events: z.array(reviewMetricEventSchema),
				nextCursor: z.string().nullable(),
			});
			const first = pageSchema.parse(await (await fetch(base, { headers })).json());
			const second = pageSchema.parse(
				await (await fetch(`${base}?cursor=${first.nextCursor}`, { headers })).json(),
			);
			const third = pageSchema.parse(
				await (await fetch(`${base}?cursor=${second.nextCursor}`, { headers })).json(),
			);
			expect([first.events.length, second.events.length, third.events.length]).toEqual([
				200, 200, 101,
			]);
			expect(
				new Set(
					[...first.events, ...second.events, ...third.events].map((event) => event.id),
				).size,
			).toBe(501);
			expect(third.nextCursor).toBeNull();
			expect((await fetch(`${base}?limit=501`, { headers })).status).toBe(400);
			expect((await fetch(`${base}?cursor=not-a-cursor`, { headers })).status).toBe(400);
		} finally {
			server.close();
			await once(server, "close");
			database.close();
		}
	});
});

function createRun(database: TestDatabase, pullRequestNumber = 30): string {
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
	const id = randomUUID();
	database.reviewRunRepository.createReviewRun({
		id,
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
	return id;
}

async function listen(server: Server): Promise<void> {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
}

function port(server: Server): number {
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("Server has no TCP address");
	return address.port;
}
