import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";
import {
	hasValidBearerToken,
	HTTP_STATUS_BAD_REQUEST,
	HTTP_STATUS_CREATED,
	HTTP_STATUS_METHOD_NOT_ALLOWED,
	HTTP_STATUS_NO_CONTENT,
	HTTP_STATUS_OK,
	HTTP_STATUS_UNAUTHORIZED,
	sendJson,
} from "#shared/http";

import {
	DASHBOARD_AUTH_REQUEST_MAXIMUM_BYTES,
	DASHBOARD_PASSWORD_MAXIMUM_LENGTH,
	DASHBOARD_PASSWORD_MINIMUM_LENGTH,
	DASHBOARD_SESSION_TOKEN_MAXIMUM_LENGTH,
	DASHBOARD_SESSION_TOKEN_MINIMUM_LENGTH,
} from "../constants/dashboard-auth.constants.js";
import type { DashboardAuthService } from "../services/dashboard-auth.service.js";

const SESSIONS_PATH = "/api/v1/dashboard/sessions";
const CREDENTIALS_SCHEMA = z.object({
	email: z.string().trim().toLowerCase().email(),
	password: z
		.string()
		.min(DASHBOARD_PASSWORD_MINIMUM_LENGTH)
		.max(DASHBOARD_PASSWORD_MAXIMUM_LENGTH),
});
const TOKEN_SCHEMA = z.object({
	token: z
		.string()
		.trim()
		.min(DASHBOARD_SESSION_TOKEN_MINIMUM_LENGTH)
		.max(DASHBOARD_SESSION_TOKEN_MAXIMUM_LENGTH),
});

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => boolean;

export function createDashboardAuthController(
	authenticator: DashboardAuthService,
	dashboardApiToken: string,
): HttpHandler {
	return (request, response) => {
		if (!isDashboardAuthRequest(request)) {
			return false;
		}

		void handleDashboardAuthRequest(request, response, authenticator, dashboardApiToken);
		return true;
	};
}

function isDashboardAuthRequest(request: IncomingMessage): boolean {
	const url = new URL(request.url ?? "/", "http://localhost");
	return url.pathname === SESSIONS_PATH || url.pathname === `${SESSIONS_PATH}/validate`;
}

async function handleDashboardAuthRequest(
	request: IncomingMessage,
	response: ServerResponse,
	authenticator: DashboardAuthService,
	dashboardApiToken: string,
): Promise<void> {
	if (!hasValidBearerToken(request, dashboardApiToken)) {
		sendJson(response, HTTP_STATUS_UNAUTHORIZED, { error: "unauthorized" });
		return;
	}

	try {
		await respondToSessionRequest(request, response, authenticator);
	} catch {
		sendJson(response, HTTP_STATUS_BAD_REQUEST, { error: "invalid_request" });
	}
}

async function respondToSessionRequest(
	request: IncomingMessage,
	response: ServerResponse,
	authenticator: DashboardAuthService,
): Promise<void> {
	switch (`${request.method} ${request.url}`) {
		case `POST ${SESSIONS_PATH}`:
			await createDashboardSession(request, response, authenticator);
			return;
		case `POST ${SESSIONS_PATH}/validate`:
			await validateDashboardSession(request, response, authenticator);
			return;
		case `DELETE ${SESSIONS_PATH}`:
			await deleteDashboardSession(request, response, authenticator);
			return;
		default:
			sendJson(response, HTTP_STATUS_METHOD_NOT_ALLOWED, { error: "method_not_allowed" });
	}
}

async function createDashboardSession(
	request: IncomingMessage,
	response: ServerResponse,
	authenticator: DashboardAuthService,
): Promise<void> {
	const parsed = CREDENTIALS_SCHEMA.safeParse(await readJsonBody(request));
	if (!parsed.success) {
		sendJson(response, HTTP_STATUS_BAD_REQUEST, { error: "invalid_credentials" });
		return;
	}

	const session = await authenticator.createSession(parsed.data);
	if (session === null) {
		sendJson(response, HTTP_STATUS_UNAUTHORIZED, { error: "invalid_credentials" });
		return;
	}

	sendJson(response, HTTP_STATUS_CREATED, { session });
}

async function validateDashboardSession(
	request: IncomingMessage,
	response: ServerResponse,
	authenticator: DashboardAuthService,
): Promise<void> {
	const token = parseSessionToken(await readJsonBody(request));
	if (token === null) {
		sendJson(response, HTTP_STATUS_BAD_REQUEST, { error: "invalid_session" });
		return;
	}

	const user = authenticator.readSession(token);
	if (user === null) {
		sendJson(response, HTTP_STATUS_UNAUTHORIZED, { error: "invalid_session" });
		return;
	}

	sendJson(response, HTTP_STATUS_OK, { user });
}

async function deleteDashboardSession(
	request: IncomingMessage,
	response: ServerResponse,
	authenticator: DashboardAuthService,
): Promise<void> {
	const token = parseSessionToken(await readJsonBody(request));
	if (token === null) {
		sendJson(response, HTTP_STATUS_BAD_REQUEST, { error: "invalid_session" });
		return;
	}

	authenticator.deleteSession(token);
	response.writeHead(HTTP_STATUS_NO_CONTENT).end();
}

function parseSessionToken(value: unknown): string | null {
	const parsed = TOKEN_SCHEMA.safeParse(value);
	return parsed.success ? parsed.data.token : null;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;

	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > DASHBOARD_AUTH_REQUEST_MAXIMUM_BYTES) {
			throw new Error("Request body exceeds the maximum size.");
		}
		chunks.push(buffer);
	}

	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
