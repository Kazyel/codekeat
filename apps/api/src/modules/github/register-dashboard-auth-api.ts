import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import type { DashboardAuthenticator } from "../dashboard-auth/dashboard-authenticator.js";

const sessionsPath = "/api/v1/dashboard/sessions";
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(256),
});
const tokenSchema = z.object({ token: z.string().trim().min(43).max(64) });

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => boolean;

export function createDashboardAuthApiHandler(
  authenticator: DashboardAuthenticator,
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
  return url.pathname === sessionsPath || url.pathname === `${sessionsPath}/validate`;
}

async function handleDashboardAuthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  authenticator: DashboardAuthenticator,
  dashboardApiToken: string,
): Promise<void> {
  if (!hasValidAuthorization(request, dashboardApiToken)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  try {
    await respondToSessionRequest(request, response, authenticator);
  } catch {
    sendJson(response, 400, { error: "invalid_request" });
  }
}

async function respondToSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  authenticator: DashboardAuthenticator,
): Promise<void> {
  if (request.method === "POST" && request.url === sessionsPath) {
    await createDashboardSession(request, response, authenticator);
    return;
  }

  if (request.method === "POST" && request.url === `${sessionsPath}/validate`) {
    await validateDashboardSession(request, response, authenticator);
    return;
  }

  if (request.method === "DELETE" && request.url === sessionsPath) {
    await deleteDashboardSession(request, response, authenticator);
    return;
  }

  sendJson(response, 405, { error: "method_not_allowed" });
}

async function createDashboardSession(
  request: IncomingMessage,
  response: ServerResponse,
  authenticator: DashboardAuthenticator,
): Promise<void> {
  const parsed = credentialsSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    sendJson(response, 400, { error: "invalid_credentials" });
    return;
  }

  const session = await authenticator.createSession(parsed.data);
  if (session === null) {
    sendJson(response, 401, { error: "invalid_credentials" });
    return;
  }

  sendJson(response, 201, { session });
}

async function validateDashboardSession(
  request: IncomingMessage,
  response: ServerResponse,
  authenticator: DashboardAuthenticator,
): Promise<void> {
  const token = parseSessionToken(await readJsonBody(request));
  if (token === null) {
    sendJson(response, 400, { error: "invalid_session" });
    return;
  }

  const user = authenticator.readSession(token);
  if (user === null) {
    sendJson(response, 401, { error: "invalid_session" });
    return;
  }

  sendJson(response, 200, { user });
}

async function deleteDashboardSession(
  request: IncomingMessage,
  response: ServerResponse,
  authenticator: DashboardAuthenticator,
): Promise<void> {
  const token = parseSessionToken(await readJsonBody(request));
  if (token === null) {
    sendJson(response, 400, { error: "invalid_session" });
    return;
  }

  authenticator.deleteSession(token);
  response.writeHead(204).end();
}

function parseSessionToken(value: unknown): string | null {
  const parsed = tokenSchema.safeParse(value);
  return parsed.success ? parsed.data.token : null;
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 4096) {
      throw new Error("Request body exceeds the maximum size.");
    }
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, statusCode: number, body: object): void {
  response
    .writeHead(statusCode, { "content-type": "application/json; charset=utf-8" })
    .end(JSON.stringify(body));
}
