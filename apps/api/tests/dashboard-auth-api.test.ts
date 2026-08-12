import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DashboardAuthenticator,
  type PasswordHasher,
} from "../src/modules/dashboard-auth/dashboard-authenticator.js";
import { createDashboardAuthApiHandler } from "../src/modules/github/register-dashboard-auth-api.js";
import { createTestDatabase } from "./test-database.js";

const internalToken = "internal-token";
const adminCredentials = { email: "admin@codekeat.local", password: "correct-password" };
const createdSessionSchema = z.object({ session: z.object({ token: z.string().length(43) }) });

describe("createDashboardAuthApiHandler", () => {
  it("creates, validates, and revokes a dashboard session", async () => {
    const database = createTestDatabase();
    const authenticator = new DashboardAuthenticator(database.store, new TestPasswordHasher());
    await authenticator.provisionInitialAdmin(adminCredentials);
    const server = createServer((request, response) => {
      if (!createDashboardAuthApiHandler(authenticator, internalToken)(request, response)) {
        response.writeHead(404).end();
      }
    });
    await listen(server);
    const baseUrl = `http://127.0.0.1:${port(server)}`;

    const unauthorized = await request(baseUrl, "/api/v1/dashboard/sessions", "POST", {
      email: adminCredentials.email,
      password: adminCredentials.password,
    });
    const invalidCredentials = await request(
      baseUrl,
      "/api/v1/dashboard/sessions",
      "POST",
      { email: adminCredentials.email, password: "incorrect-password" },
      true,
    );
    const created = await request(
      baseUrl,
      "/api/v1/dashboard/sessions",
      "POST",
      adminCredentials,
      true,
    );
    const createdPayload = createdSessionSchema.parse(await created.json());
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
    expect(await validated.json()).toMatchObject({ user: { email: adminCredentials.email } });
    expect(deleted.status).toBe(204);
    expect(revoked.status).toBe(401);

    await close(server);
    database.close();
  });
});

class TestPasswordHasher implements PasswordHasher {
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
      ? { authorization: `Bearer ${internalToken}`, "content-type": "application/json" }
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
