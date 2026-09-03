import { installations, repositories } from "@codekeat/database";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { expect, it } from "vitest";

import { createGitHubConnectionReadController } from "#features/github";
import { createTestDatabase } from "./test-database.js";

const INTERNAL_TOKEN = "internal-token";
const CONNECTIONS_PATH = "/api/v1/github/connections";

it("returns the ordered GitHub inventory to authenticated dashboard requests", async () => {
	const database = createTestDatabase();
	database.connection.db
		.insert(installations)
		.values([
			{
				githubInstallationId: 1001,
				accountLogin: "alpha-allowed",
				status: "active",
				createdAt: "2026-09-03T10:00:00.000Z",
				updatedAt: "2026-09-03T12:00:00.000Z",
			},
			{
				githubInstallationId: 1003,
				accountLogin: "alpha-allowed",
				status: "deleted",
				createdAt: "2026-09-03T10:00:00.000Z",
				updatedAt: "2026-09-03T13:00:00.000Z",
			},
			{
				githubInstallationId: 1002,
				accountLogin: "zeta-blocked",
				status: "suspended",
				createdAt: "2026-09-03T10:00:00.000Z",
				updatedAt: "2026-09-03T11:00:00.000Z",
			},
		])
		.run();
	database.connection.db
		.insert(repositories)
		.values([
			{
				githubRepositoryId: 2001,
				installationId: 1001,
				ownerLogin: "alpha-owner",
				name: "zeta-repository",
				defaultBranch: "main",
				status: "active",
				createdAt: "2026-09-03T10:00:00.000Z",
				updatedAt: "2026-09-03T12:00:00.000Z",
			},
			{
				githubRepositoryId: 2003,
				installationId: 1001,
				ownerLogin: "alpha-owner",
				name: "beta-repository",
				defaultBranch: "unknown",
				status: "removed",
				createdAt: "2026-09-03T10:00:00.000Z",
				updatedAt: "2026-09-03T11:30:00.000Z",
			},
			{
				githubRepositoryId: 2002,
				installationId: 1001,
				ownerLogin: "zeta-owner",
				name: "alpha-repository",
				defaultBranch: "develop",
				status: "active",
				createdAt: "2026-09-03T10:00:00.000Z",
				updatedAt: "2026-09-03T11:00:00.000Z",
			},
		])
		.run();

	const controller = createGitHubConnectionReadController(
		database.githubAccessRepository,
		new Set(["alpha-allowed"]),
		INTERNAL_TOKEN,
	);
	const server = createServer((request, response) => {
		if (!controller(request, response)) {
			response.writeHead(404).end();
		}
	});
	await listen(server);
	const url = `http://127.0.0.1:${port(server)}${CONNECTIONS_PATH}`;

	const unauthorized = await fetch(url);
	const wrongMethod = await fetch(url, {
		method: "POST",
		headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
	});
	const response = await fetch(url, {
		headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
	});

	expect(unauthorized.status).toBe(401);
	expect(await unauthorized.json()).toEqual({ error: "unauthorized" });
	expect(wrongMethod.status).toBe(405);
	expect(await wrongMethod.json()).toEqual({ error: "method_not_allowed" });
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		connections: [
			{
				githubInstallationId: 1003,
				accountLogin: "alpha-allowed",
				status: "deleted",
				allowedByConfiguration: true,
				updatedAt: "2026-09-03T13:00:00.000Z",
				repositories: [],
			},
			{
				githubInstallationId: 1001,
				accountLogin: "alpha-allowed",
				status: "active",
				allowedByConfiguration: true,
				updatedAt: "2026-09-03T12:00:00.000Z",
				repositories: [
					{
						githubRepositoryId: 2003,
						fullName: "alpha-owner/beta-repository",
						defaultBranch: null,
						status: "removed",
						updatedAt: "2026-09-03T11:30:00.000Z",
					},
					{
						githubRepositoryId: 2001,
						fullName: "alpha-owner/zeta-repository",
						defaultBranch: "main",
						status: "active",
						updatedAt: "2026-09-03T12:00:00.000Z",
					},
					{
						githubRepositoryId: 2002,
						fullName: "zeta-owner/alpha-repository",
						defaultBranch: "develop",
						status: "active",
						updatedAt: "2026-09-03T11:00:00.000Z",
					},
				],
			},
			{
				githubInstallationId: 1002,
				accountLogin: "zeta-blocked",
				status: "suspended",
				allowedByConfiguration: false,
				updatedAt: "2026-09-03T11:00:00.000Z",
				repositories: [],
			},
		],
	});

	await close(server);
	database.close();
});

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
