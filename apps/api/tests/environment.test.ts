import { describe, expect, it } from "vitest";

import { loadEnvironment } from "../src/bootstrap/environment.js";

const validEnvironment = {
  APP_ID: "123",
  PRIVATE_KEY: "private-key",
  WEBHOOK_SECRET: "webhook-secret",
  DATABASE_PATH: ":memory:",
  ALLOWED_GITHUB_ORGANIZATIONS: "Takeat, partner-org ",
  REVIEW_MODE: "advisory",
};

describe("loadEnvironment", () => {
  it("normalizes the organization allowlist", () => {
    const environment = loadEnvironment(validEnvironment);

    expect(environment.allowedGithubOrganizations).toEqual(new Set(["takeat", "partner-org"]));
  });

  it("rejects an empty organization allowlist", () => {
    expect(() =>
      loadEnvironment({ ...validEnvironment, ALLOWED_GITHUB_ORGANIZATIONS: " , " }),
    ).toThrow("ALLOWED_GITHUB_ORGANIZATIONS");
  });
});
