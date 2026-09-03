import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	type Argon2PasswordService,
	createDashboardAuthController,
	DashboardAuthService,
} from "#features/auth";
import { createTestDatabase } from "./test-database.js";

const INTERNAL_TOKEN = "internal-token";
const ADMIN_CREDENTIALS = { email: "admin@codekeat.local", password: "correct-password" };
const CREATED_SESSION_SCHEMA = z.object({ session: z.object({ token: z.string().length(43) }) });

describe("createDashboardAuthController", () => {
	it("creates, validates, and revokes a dashboard session", async () => {
		const database = createTestDatabase();
		const authenticator = new DashboardAuthService(
			database.authRepository,
			new TestPasswordService(),
		);
		await authenticator.provisionInitialAdmin(ADMIN_CREDENTIALS);
		const server = createServer((request, response) => {
			if (!createDashboardAuthController(authenticator, INTERNAL_TOKEN)(request, response)) {
				response.writeHead(404).end();
			}
		});
		await listen(server);
		const baseUrl = `http://127.0.0.1:${port(server)}`;

		const unauthorized = await request(baseUrl, "/api/v1/dashboard/sessions", "POST", {
			email: ADMIN_CREDENTIALS.email,
			password: ADMIN_CREDENTIALS.password,
		});
		const invalidCredentials = await request(
			baseUrl,
			"/api/v1/dashboard/sessions",
			"POST",
			{ email: ADMIN_CREDENTIALS.email, password: "incorrect-password" },
			true,
		);
		const created = await request(
			baseUrl,
			"/api/v1/dashboard/sessions",
			"POST",
			ADMIN_CREDENTIALS,
			true,
		);
		const createdPayload = CREATED_SESSION_SCHEMA.parse(await created.json());
		const validated = await request(
			baseUrl,
			"/api/v1/dashboard/sessions/validate",
			"POST",
			{
				token: createdPayload.session.token,
			},
			true,
		);
		const deleted = await request(
			baseUrl,
			"/api/v1/dashboard/sessions",
			"DELETE",
			{
				token: createdPayload.session.token,
			},
			true,
		);
		const revoked = await request(
			baseUrl,
			"/api/v1/dashboard/sessions/validate",
			"POST",
			{
				token: createdPayload.session.token,
			},
			true,
		);

		expect(unauthorized.status).toBe(401);
		expect(invalidCredentials.status).toBe(401);
		expect(created.status).toBe(201);
		expect(createdPayload.session.token).toHaveLength(43);
		expect(validated.status).toBe(200);
		expect(await validated.json()).toMatchObject({ user: { email: ADMIN_CREDENTIALS.email } });
		expect(deleted.status).toBe(204);
		expect(revoked.status).toBe(401);

		await close(server);
		database.close();
	});
});

class TestPasswordService implements Argon2PasswordService {
	async hash(password: string): Promise<string> {
		return `hash:${password}`;
	}

	async verify(passwordHash: string, password: string): Promise<boolean> {
		return passwordHash === `hash:${password}`;
	}
}

async function request(
	baseUrl: string,
	path: string,
	method: "DELETE" | "POST",
	body: object,
	authorized = false,
): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		method,
		headers: authorized
			? { authorization: `Bearer ${INTERNAL_TOKEN}`, "content-type": "application/json" }
			: { "content-type": "application/json" },
		body: JSON.stringify(body),
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
