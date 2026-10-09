import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";
import { hasValidBearerToken, sendJson } from "#shared/http";
import type { ReviewTelemetryRepository } from "../repositories/review-telemetry.repository.js";
import type { ReviewTelemetryCursor, ReviewTelemetryPage } from "../types/review-metrics.types.js";

const TELEMETRY_PATH = "/api/v1/review-telemetry";
const QUERY_SCHEMA = z
	.object({
		groupBy: z.enum(["day", "week", "month"]).default("day"),
		days: z.coerce.number().int().min(1).max(90).default(30),
		repository: z
			.string()
			.regex(/^[^/\s]+\/[^/\s]+$/)
			.optional(),
	})
	.strict();
const CURSOR_SCHEMA = z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).strict();
const PAGE_SCHEMA = z
	.object({
		limit: z.coerce.number().int().min(1).max(500).default(200),
		cursor: z.string().max(512).optional(),
	})
	.strict();

export function createReviewTelemetryController(
	repository: ReviewTelemetryRepository,
	dashboardApiToken: string,
): (request: IncomingMessage, response: ServerResponse) => boolean {
	return (request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		if (request.method !== "GET" || !isTelemetryPath(url.pathname)) return false;
		if (!hasValidBearerToken(request, dashboardApiToken)) {
			sendJson(response, 401, { error: "unauthorized" });
			return true;
		}
		return respond(url, response, repository);
	};
}

function isTelemetryPath(pathname: string): boolean {
	return pathname === TELEMETRY_PATH || pathname.startsWith(`${TELEMETRY_PATH}/`);
}

function respond(
	url: URL,
	response: ServerResponse,
	repository: ReviewTelemetryRepository,
): boolean {
	if (url.pathname === TELEMETRY_PATH) return respondSummary(url, response, repository);
	return respondRun(url, response, repository);
}

function respondRun(
	url: URL,
	response: ServerResponse,
	repository: ReviewTelemetryRepository,
): boolean {
	const parsed = z.uuid().safeParse(url.pathname.slice(TELEMETRY_PATH.length + 1));
	if (!parsed.success) {
		sendJson(response, 404, { error: "not_found" });
		return true;
	}
	const query = PAGE_SCHEMA.safeParse(Object.fromEntries(url.searchParams));
	if (!query.success) return invalidQuery(response);
	const cursor = parseCursor(query.data.cursor);
	if (cursor === "invalid") return invalidQuery(response);
	const page = repository.findRunEvents(parsed.data, query.data.limit, cursor);
	return sendPage(response, page);
}

function sendPage(response: ServerResponse, page: ReviewTelemetryPage | null): true {
	if (page === null) sendJson(response, 404, { error: "not_found" });
	else
		sendJson(response, 200, { events: page.events, nextCursor: encodeCursor(page.nextCursor) });
	return true;
}

function parseCursor(encoded: string | undefined): ReviewTelemetryCursor | null | "invalid" {
	if (encoded === undefined) return null;
	try {
		return CURSOR_SCHEMA.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
	} catch {
		return "invalid";
	}
}

function encodeCursor(cursor: ReviewTelemetryCursor | null): string | null {
	return cursor === null ? null : Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function invalidQuery(response: ServerResponse): true {
	sendJson(response, 400, { error: "invalid_query" });
	return true;
}

function respondSummary(
	url: URL,
	response: ServerResponse,
	repository: ReviewTelemetryRepository,
): boolean {
	const parsed = QUERY_SCHEMA.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		sendJson(response, 400, { error: "invalid_query" });
		return true;
	}
	const { days, groupBy, repository: repositoryFullName } = parsed.data;
	const since = new Date(Date.now() - days * 86_400_000).toISOString();
	sendJson(response, 200, {
		days,
		summaries: repository.listSummaries(groupBy, since, repositoryFullName),
	});
	return true;
}
