import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";

import { createReviewReadController } from "#features/review";
import { createTestDatabase } from "./test-database.js";

describe("createReviewReadController", () => {
	it("requires the internal token and returns run summaries and details", async () => {
		const database = createTestDatabase();
		const reviewRunId = randomUUID();
		prepareReviewRun(database, reviewRunId);
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
		expect(await list.json()).toMatchObject({ reviewRuns: [{ id: reviewRunId }] });
		expect(await detail.json()).toMatchObject({
			reviewRun: { id: reviewRunId, findingCount: 0 },
		});
		await close(server);
		database.close();
	});
});

function prepareReviewRun(
	database: ReturnType<typeof createTestDatabase>,
	reviewRunId: string,
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
		pullRequestNumber: 30,
		headSha: "a".repeat(40),
		trigger: "opened",
		status: "queued",
		policyJson: '{"enabled":true,"version":1}',
		policySource: "default",
		policyWarningCode: null,
		ignoreReason: null,
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
