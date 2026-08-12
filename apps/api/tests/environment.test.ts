import { describe, expect, it } from "vitest";

import { loadEnvironment } from "../src/bootstrap/environment.js";

const validEnvironment = {
  APP_ID: "123",
  PRIVATE_KEY: "private-key",
  WEBHOOK_SECRET: "webhook-secret",
  DATABASE_PATH: ":memory:",
  ALLOWED_GITHUB_ACCOUNTS: "Takeat, mateusmascarelo ",
  GOOGLE_API_KEY: "google-api-key",
  GEMINI_MODEL: "gemini-3.6-flash",
  DASHBOARD_API_TOKEN: "dashboard-api-token",
  INITIAL_ADMIN_EMAIL: "admin@codekeat.local",
  INITIAL_ADMIN_PASSWORD: "correct-password",
  REVIEW_MODE: "advisory",
};

describe("loadEnvironment", () => {
  it("normalizes the allowlist for organizations and personal accounts", () => {
    const environment = loadEnvironment(validEnvironment);

    expect(environment.allowedGithubAccounts).toEqual(new Set(["takeat", "mateusmascarelo"]));
  });

  it("rejects an empty organization allowlist", () => {
    expect(() => loadEnvironment({ ...validEnvironment, ALLOWED_GITHUB_ACCOUNTS: " , " })).toThrow(
      "ALLOWED_GITHUB_ACCOUNTS",
    );
  });

  it("accepts a private key path", () => {
    expect(
      loadEnvironment({
        ...validEnvironment,
        PRIVATE_KEY: "",
        PRIVATE_KEY_PATH: "../../secrets/codekeat-dev.pem",
      }),
    ).toMatchObject({ databasePath: ":memory:" });
  });

  it("requires a private key value or path", () => {
    expect(() =>
      loadEnvironment({ ...validEnvironment, PRIVATE_KEY: "", PRIVATE_KEY_PATH: "" }),
    ).toThrow("PRIVATE_KEY");
  });

  it("requires Gemini credentials and model selection", () => {
    expect(() => loadEnvironment({ ...validEnvironment, GOOGLE_API_KEY: "" })).toThrow(
      "GOOGLE_API_KEY",
    );
    expect(() => loadEnvironment({ ...validEnvironment, GEMINI_MODEL: "" })).toThrow(
      "GEMINI_MODEL",
    );
  });

  it("requires the dashboard API token", () => {
    expect(() => loadEnvironment({ ...validEnvironment, DASHBOARD_API_TOKEN: "" })).toThrow(
      "DASHBOARD_API_TOKEN",
    );
  });

  it("requires initial administrator credentials", () => {
    expect(() => loadEnvironment({ ...validEnvironment, INITIAL_ADMIN_EMAIL: "" })).toThrow(
      "INITIAL_ADMIN_EMAIL",
    );
    expect(() => loadEnvironment({ ...validEnvironment, INITIAL_ADMIN_PASSWORD: "short" })).toThrow(
      "INITIAL_ADMIN_PASSWORD",
    );
    expect(
      loadEnvironment({ ...validEnvironment, INITIAL_ADMIN_PASSWORD: "password" }),
    ).toMatchObject({ initialAdminPassword: "password" });
  });
});
