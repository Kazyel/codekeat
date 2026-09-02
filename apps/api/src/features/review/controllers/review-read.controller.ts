import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";
import {
	hasValidBearerToken,
	HTTP_STATUS_NOT_FOUND,
	HTTP_STATUS_OK,
	HTTP_STATUS_UNAUTHORIZED,
	sendJson,
} from "#shared/http";

import type { ReviewQueryRepository } from "../repositories/review-query.repository.js";

const REVIEW_RUNS_PATH = "/api/v1/review-runs";
const REVIEW_RUN_ID_SCHEMA = z.string().uuid();

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => boolean;

export function createReviewReadController(
	repository: ReviewQueryRepository,
	dashboardApiToken: string,
): HttpHandler {
	return (request, response) => handleRequest(request, response, repository, dashboardApiToken);
}

function handleRequest(
	request: IncomingMessage,
	response: ServerResponse,
	repository: ReviewQueryRepository,
	dashboardApiToken: string,
): boolean {
	if (request.method !== "GET") {
		return false;
	}

	const url = new URL(request.url ?? "/", "http://localhost");
	if (!url.pathname.startsWith(REVIEW_RUNS_PATH)) {
		return false;
	}

	if (!hasValidBearerToken(request, dashboardApiToken)) {
		sendJson(response, HTTP_STATUS_UNAUTHORIZED, { error: "unauthorized" });
		return true;
	}

	return respondToReviewRunRequest(url.pathname, response, repository);
}

function respondToReviewRunRequest(
	pathname: string,
	response: ServerResponse,
	repository: ReviewQueryRepository,
): boolean {
	if (pathname === REVIEW_RUNS_PATH) {
		sendJson(response, HTTP_STATUS_OK, { reviewRuns: repository.listReviewRunSummaries() });
		return true;
	}

	const reviewRunId = parseReviewRunId(pathname);
	if (reviewRunId === null) {
		sendJson(response, HTTP_STATUS_NOT_FOUND, { error: "not_found" });
		return true;
	}

	const reviewRun = repository.findReviewRunDetail(reviewRunId);
	if (reviewRun === null) {
		sendJson(response, HTTP_STATUS_NOT_FOUND, { error: "not_found" });
		return true;
	}

	sendJson(response, HTTP_STATUS_OK, { reviewRun });
	return true;
}

function parseReviewRunId(pathname: string): string | null {
	const prefix = `${REVIEW_RUNS_PATH}/`;
	if (!pathname.startsWith(prefix)) {
		return null;
	}

	const reviewRunId = pathname.slice(prefix.length);
	const parsed = REVIEW_RUN_ID_SCHEMA.safeParse(reviewRunId);
	return parsed.success ? parsed.data : null;
}
