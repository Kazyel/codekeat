import { describe, expect, it } from "vitest";

import { loadEnvironment } from "../src/bootstrap/environment.js";

const validEnvironment = {
  APP_ID: "123",
  PRIVATE_KEY: "private-key",
  WEBHOOK_SECRET: "webhook-secret",
  DATABASE_PATH: ":memory:",
  ALLOWED_GITHUB_ACCOUNTS: "Takeat, mateusmascarelo ",
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
});
