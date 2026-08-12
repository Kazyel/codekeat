import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { WebhookStore } from "@codekeat/database";
import { z } from "zod";

const reviewRunsPath = "/api/v1/review-runs";
const reviewRunIdSchema = z.string().uuid();

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => boolean;

export function createReadApiHandler(store: WebhookStore, dashboardApiToken: string): HttpHandler {
  return (request, response) => handleRequest(request, response, store, dashboardApiToken);
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: WebhookStore,
  dashboardApiToken: string,
): boolean {
  if (request.method !== "GET") {
    return false;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(reviewRunsPath)) {
    return false;
  }

  if (!hasValidAuthorization(request, dashboardApiToken)) {
    sendJson(response, 401, { error: "unauthorized" });
    return true;
  }

  return respondToReviewRunRequest(url.pathname, response, store);
}

function hasValidAuthorization(request: IncomingMessage, dashboardApiToken: string): boolean {
  const authorization = request.headers.authorization;
  if (authorization === undefined || Array.isArray(authorization)) {
    return false;
  }

  const expected = `Bearer ${dashboardApiToken}`;
  const actualBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function respondToReviewRunRequest(
  pathname: string,
  response: ServerResponse,
  store: WebhookStore,
): boolean {
  if (pathname === reviewRunsPath) {
    sendJson(response, 200, { reviewRuns: store.listReviewRunSummaries() });
    return true;
  }

  const reviewRunId = parseReviewRunId(pathname);
  if (reviewRunId === null) {
    sendJson(response, 404, { error: "not_found" });
    return true;
  }

  const reviewRun = store.findReviewRunDetail(reviewRunId);
  if (reviewRun === null) {
    sendJson(response, 404, { error: "not_found" });
    return true;
  }

  sendJson(response, 200, { reviewRun });
  return true;
}

function parseReviewRunId(pathname: string): string | null {
  const prefix = `${reviewRunsPath}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const reviewRunId = pathname.slice(prefix.length);
  const parsed = reviewRunIdSchema.safeParse(reviewRunId);
  return parsed.success ? parsed.data : null;
}

function sendJson(response: ServerResponse, statusCode: number, body: object): void {
  response
    .writeHead(statusCode, { "content-type": "application/json; charset=utf-8" })
    .end(JSON.stringify(body));
}
