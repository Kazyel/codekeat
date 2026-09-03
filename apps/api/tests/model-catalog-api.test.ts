import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { expect, it } from "vitest";
import { z } from "zod";

import { type Argon2PasswordService, DashboardAuthService } from "#features/auth";
import { createModelCatalogController } from "#features/models";
import { createTestDatabase } from "./test-database.js";

const INTERNAL_TOKEN = "internal-token";
const CREDENTIALS = { email: "admin@codekeat.local", password: "correct-password" };
const MODEL_INPUT = {
	displayName: "Gemini Future Flash",
	apiName: "gemini-future-flash",
	inputNanoUsdPerToken: 800,
	cachedInputNanoUsdPerToken: 80,
	outputNanoUsdPerToken: 4_000,
	enabled: true,
};
const SESSION_SCHEMA = z.object({ token: z.string() });
const CREATED_MODEL_SCHEMA = z.object({ model: z.object({ id: z.string().uuid() }) });

it("seeds models and restricts catalog mutations to administrators", async () => {
	const database = createTestDatabase();
	const authenticator = new DashboardAuthService(
		database.authRepository,
		new TestPasswordService(),
	);
	await authenticator.provisionInitialAdmin(CREDENTIALS);
	database.authRepository.createDashboardUserIfMissing({
		id: randomUUID(),
		email: "member@codekeat.local",
		passwordHash: `hash:${CREDENTIALS.password}`,
		role: "member",
	});
	const adminSession = SESSION_SCHEMA.parse(await authenticator.createSession(CREDENTIALS)).token;
	const memberSession = SESSION_SCHEMA.parse(
		await authenticator.createSession({
			email: "member@codekeat.local",
			password: CREDENTIALS.password,
		}),
	).token;
	const controller = createModelCatalogController(
		database.modelCatalogRepository,
		authenticator,
		INTERNAL_TOKEN,
	);
	const server = createServer((request, response) => {
		if (!controller(request, response)) {
			response.writeHead(404).end();
		}
	});
	await listen(server);
	const baseUrl = `http://127.0.0.1:${port(server)}`;

	const missingSession = await request(baseUrl, "/api/v1/models", "GET");
	const memberList = await request(baseUrl, "/api/v1/models", "GET", memberSession);
	const seeded = z
		.object({ models: z.array(z.object({ apiName: z.string(), selected: z.boolean() })) })
		.parse(await memberList.json());
	const memberMutation = await request(
		baseUrl,
		"/api/v1/models",
		"POST",
		memberSession,
		MODEL_INPUT,
	);
	const created = await request(baseUrl, "/api/v1/models", "POST", adminSession, MODEL_INPUT);
	const createdId = CREATED_MODEL_SCHEMA.parse(await created.json()).model.id;
	const duplicate = await request(baseUrl, "/api/v1/models", "POST", adminSession, MODEL_INPUT);
	const updated = await request(baseUrl, `/api/v1/models/${createdId}`, "PATCH", adminSession, {
		outputNanoUsdPerToken: 4_500,
	});
	const selected = await request(
		baseUrl,
		`/api/v1/models/${createdId}/select`,
		"POST",
		adminSession,
	);
	const disableSelected = await request(
		baseUrl,
		`/api/v1/models/${createdId}`,
		"PATCH",
		adminSession,
		{ enabled: false },
	);

	expect(missingSession.status).toBe(401);
	expect(memberList.status).toBe(200);
	expect(seeded.models).toHaveLength(6);
	expect(seeded.models.filter((model) => model.selected)).toEqual([
		expect.objectContaining({ apiName: "gemini-3.8-flash" }),
	]);
	expect(memberMutation.status).toBe(403);
	expect(created.status).toBe(201);
	expect(duplicate.status).toBe(409);
	expect(updated.status).toBe(200);
	expect(selected.status).toBe(200);
	expect(disableSelected.status).toBe(409);
	expect(database.modelCatalogRepository.listModels().filter((model) => model.selected)).toEqual([
		expect.objectContaining({ id: createdId, outputNanoUsdPerToken: 4_500 }),
	]);

	await close(server);
	database.close();
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
	method: "GET" | "PATCH" | "POST",
	sessionToken?: string,
	body?: object,
): Promise<Response> {
	const headers: Record<string, string> = {
		authorization: `Bearer ${INTERNAL_TOKEN}`,
		"content-type": "application/json",
	};
	if (sessionToken !== undefined) {
		headers["x-dashboard-session"] = sessionToken;
	}
	const options: RequestInit = { method, headers };
	if (body !== undefined) {
		options.body = JSON.stringify(body);
	}
	return fetch(`${baseUrl}${path}`, options);
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
