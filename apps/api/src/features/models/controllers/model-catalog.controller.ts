import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthenticatedDashboardUser, DashboardAuthService } from "#features/auth";

import {
	CREATE_MODEL_SCHEMA,
	MAXIMUM_MODEL_REQUEST_BYTES,
	MODEL_ID_SCHEMA,
	MODELS_PATH,
	SESSION_TOKEN_SCHEMA,
	UPDATE_MODEL_SCHEMA,
} from "../constants/models.constants.js";

import {
	hasValidBearerToken,
	HTTP_STATUS_BAD_REQUEST,
	HTTP_STATUS_CONFLICT,
	HTTP_STATUS_CREATED,
	HTTP_STATUS_FORBIDDEN,
	HTTP_STATUS_METHOD_NOT_ALLOWED,
	HTTP_STATUS_NOT_FOUND,
	HTTP_STATUS_OK,
	HTTP_STATUS_UNAUTHORIZED,
	sendJson,
} from "#shared/http";

import type { ModelCatalogRepository } from "../repositories/model-catalog.repository.js";

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => boolean;
type ModelRequestTarget =
	| { readonly kind: "collection" }
	| { readonly kind: "model"; readonly id: string }
	| { readonly kind: "select"; readonly id: string };

export function createModelCatalogController(
	repository: ModelCatalogRepository,
	authenticator: DashboardAuthService,
	dashboardApiToken: string,
): HttpHandler {
	return (request, response) => {
		const target = parseRequestTarget(request.url);
		if (target === null) {
			return false;
		}

		void handleRequest(request, response, target, repository, authenticator, dashboardApiToken);
		return true;
	};
}

async function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	target: ModelRequestTarget,
	repository: ModelCatalogRepository,
	authenticator: DashboardAuthService,
	dashboardApiToken: string,
): Promise<void> {
	if (!hasValidBearerToken(request, dashboardApiToken)) {
		sendJson(response, HTTP_STATUS_UNAUTHORIZED, { error: "unauthorized" });
		return;
	}

	const user = readAuthenticatedUser(request, authenticator);
	if (user === null) {
		sendJson(response, HTTP_STATUS_UNAUTHORIZED, { error: "invalid_session" });
		return;
	}

	if (isCatalogListRequest(request, target)) {
		sendJson(response, HTTP_STATUS_OK, { models: repository.listModels() });
		return;
	}

	if (user.role !== "admin") {
		sendJson(response, HTTP_STATUS_FORBIDDEN, { error: "forbidden" });
		return;
	}

	await handleAdminRequest(request, response, target, repository);
}

async function handleAdminRequest(
	request: IncomingMessage,
	response: ServerResponse,
	target: ModelRequestTarget,
	repository: ModelCatalogRepository,
): Promise<void> {
	try {
		await dispatchAdminRequest(request, response, target, repository);
	} catch {
		sendJson(response, HTTP_STATUS_BAD_REQUEST, { error: "invalid_request" });
	}
}

async function dispatchAdminRequest(
	request: IncomingMessage,
	response: ServerResponse,
	target: ModelRequestTarget,
	repository: ModelCatalogRepository,
): Promise<void> {
	if (isCollectionRequest(request, target, "POST")) {
		await createModel(request, response, repository);
		return;
	}
	if (isModelRequest(request, target, "PATCH")) {
		await updateModel(request, response, target.id, repository);
		return;
	}
	if (isSelectionRequest(request, target, "POST")) {
		selectModel(response, target.id, repository);
		return;
	}

	sendJson(response, HTTP_STATUS_METHOD_NOT_ALLOWED, { error: "method_not_allowed" });
}

async function createModel(
	request: IncomingMessage,
	response: ServerResponse,
	repository: ModelCatalogRepository,
): Promise<void> {
	const input = CREATE_MODEL_SCHEMA.safeParse(await readJsonBody(request));
	if (!input.success) {
		sendJson(response, HTTP_STATUS_BAD_REQUEST, { error: "invalid_model" });
		return;
	}

	const model = repository.createModel(input.data);
	if (model === null) {
		sendJson(response, HTTP_STATUS_CONFLICT, { error: "duplicate_model" });
		return;
	}

	sendJson(response, HTTP_STATUS_CREATED, { model });
}

async function updateModel(
	request: IncomingMessage,
	response: ServerResponse,
	id: string,
	repository: ModelCatalogRepository,
): Promise<void> {
	const input = UPDATE_MODEL_SCHEMA.safeParse(await readJsonBody(request));
	if (!input.success) {
		sendJson(response, HTTP_STATUS_BAD_REQUEST, { error: "invalid_model" });
		return;
	}

	const result = repository.updateModel(id, input.data);
	if (result === "not_found") {
		sendJson(response, HTTP_STATUS_NOT_FOUND, { error: "model_not_found" });
		return;
	}
	if (result !== "updated") {
		sendJson(response, HTTP_STATUS_CONFLICT, { error: `${result}_model` });
		return;
	}

	sendJson(response, HTTP_STATUS_OK, { result });
}

function selectModel(
	response: ServerResponse,
	id: string,
	repository: ModelCatalogRepository,
): void {
	const result = repository.selectModel(id);
	if (result === "not_found") {
		sendJson(response, HTTP_STATUS_NOT_FOUND, { error: "model_not_found" });
		return;
	}
	if (result === "disabled") {
		sendJson(response, HTTP_STATUS_CONFLICT, { error: "disabled_model" });
		return;
	}

	sendJson(response, HTTP_STATUS_OK, { result });
}

function readAuthenticatedUser(
	request: IncomingMessage,
	authenticator: DashboardAuthService,
): AuthenticatedDashboardUser | null {
	const token = request.headers["x-dashboard-session"];
	const parsed = SESSION_TOKEN_SCHEMA.safeParse(token);
	if (!parsed.success) {
		return null;
	}
	return authenticator.readSession(parsed.data);
}

function isCatalogListRequest(request: IncomingMessage, target: ModelRequestTarget): boolean {
	return isCollectionRequest(request, target, "GET");
}

function isCollectionRequest(
	request: IncomingMessage,
	target: ModelRequestTarget,
	method: string,
): target is { readonly kind: "collection" } {
	return request.method === method && target.kind === "collection";
}

function isModelRequest(
	request: IncomingMessage,
	target: ModelRequestTarget,
	method: string,
): target is { readonly kind: "model"; readonly id: string } {
	return request.method === method && target.kind === "model";
}

function isSelectionRequest(
	request: IncomingMessage,
	target: ModelRequestTarget,
	method: string,
): target is { readonly kind: "select"; readonly id: string } {
	return request.method === method && target.kind === "select";
}

function parseRequestTarget(urlValue: string | undefined): ModelRequestTarget | null {
	const pathname = new URL(urlValue === undefined ? "/" : urlValue, "http://localhost").pathname;
	if (pathname === MODELS_PATH) {
		return { kind: "collection" };
	}
	if (!pathname.startsWith(`${MODELS_PATH}/`)) {
		return null;
	}
	return parseModelRequestTarget(pathname);
}

function parseModelRequestTarget(pathname: string): ModelRequestTarget | null {
	const match = /^\/api\/v1\/models\/([^/]+)(\/select)?$/.exec(pathname);
	if (match === null) {
		return null;
	}
	const id = MODEL_ID_SCHEMA.safeParse(match[1]);
	if (!id.success) {
		return null;
	}
	if (match[2] === undefined) {
		return { kind: "model", id: id.data };
	}
	return { kind: "select", id: id.data };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;

	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAXIMUM_MODEL_REQUEST_BYTES) {
			throw new Error("Request body exceeds the maximum size.");
		}
		chunks.push(buffer);
	}

	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
