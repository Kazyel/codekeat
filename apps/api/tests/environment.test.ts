import { describe, expect, it } from "vitest";

import { loadEnvironment } from "../src/bootstrap/environment.js";

const VALID_ENVIRONMENT = {
	APP_ID: "123",
	PRIVATE_KEY: "private-key",
	WEBHOOK_SECRET: "webhook-secret",
	DATABASE_PATH: ":memory:",
	ALLOWED_GITHUB_ACCOUNTS: "Takeat, mateusmascarelo ",
	GOOGLE_API_KEY: "google-api-key",
	TAKEAT_MCP_URL: "https://mcp.takeat.example/mcp",
	TAKEAT_MCP_TOKEN_URL: "https://mcp.takeat.example/oauth/token",
	TAKEAT_MCP_CLIENT_ID: "codekeat",
	TAKEAT_MCP_CLIENT_SECRET: "takeat-mcp-client-secret",
	DASHBOARD_API_TOKEN: "dashboard-api-token",
	INITIAL_ADMIN_EMAIL: "admin@codekeat.local",
	INITIAL_ADMIN_PASSWORD: "correct-password",
	REVIEW_MODE: "advisory",
};

describe("loadEnvironment", () => {
	it("normalizes the allowlist for organizations and personal accounts", () => {
		const environment = loadEnvironment(VALID_ENVIRONMENT);

		expect(environment.allowedGithubAccounts).toEqual(new Set(["takeat", "mateusmascarelo"]));
	});

	it("rejects an empty organization allowlist", () => {
		expect(() =>
			loadEnvironment({ ...VALID_ENVIRONMENT, ALLOWED_GITHUB_ACCOUNTS: " , " }),
		).toThrow("ALLOWED_GITHUB_ACCOUNTS");
	});

	it("accepts a private key path", () => {
		expect(
			loadEnvironment({
				...VALID_ENVIRONMENT,
				PRIVATE_KEY: "",
				PRIVATE_KEY_PATH: "../../secrets/codekeat-dev.pem",
			}),
		).toMatchObject({ databasePath: ":memory:" });
	});

	it("requires a private key value or path", () => {
		expect(() =>
			loadEnvironment({ ...VALID_ENVIRONMENT, PRIVATE_KEY: "", PRIVATE_KEY_PATH: "" }),
		).toThrow("PRIVATE_KEY");
	});

	it("requires only the Gemini API credential from the environment", () => {
		expect(() => loadEnvironment({ ...VALID_ENVIRONMENT, GOOGLE_API_KEY: "" })).toThrow(
			"GOOGLE_API_KEY",
		);
		expect(loadEnvironment({ ...VALID_ENVIRONMENT, GEMINI_MODEL: "" })).not.toHaveProperty(
			"geminiModel",
		);
	});

	it("requires HTTPS Takeat MCP endpoints and client credentials", () => {
		expect(() =>
			loadEnvironment({ ...VALID_ENVIRONMENT, TAKEAT_MCP_URL: "http://mcp.example/mcp" }),
		).toThrow("TAKEAT_MCP_URL");
		expect(() =>
			loadEnvironment({ ...VALID_ENVIRONMENT, TAKEAT_MCP_TOKEN_URL: "not-a-url" }),
		).toThrow("TAKEAT_MCP_TOKEN_URL");
		expect(() => loadEnvironment({ ...VALID_ENVIRONMENT, TAKEAT_MCP_CLIENT_ID: "" })).toThrow(
			"TAKEAT_MCP_CLIENT_ID",
		);
		expect(() =>
			loadEnvironment({ ...VALID_ENVIRONMENT, TAKEAT_MCP_CLIENT_SECRET: "" }),
		).toThrow("TAKEAT_MCP_CLIENT_SECRET");
	});

	it("requires the dashboard API token", () => {
		expect(() => loadEnvironment({ ...VALID_ENVIRONMENT, DASHBOARD_API_TOKEN: "" })).toThrow(
			"DASHBOARD_API_TOKEN",
		);
	});

	it("requires initial administrator credentials", () => {
		expect(() => loadEnvironment({ ...VALID_ENVIRONMENT, INITIAL_ADMIN_EMAIL: "" })).toThrow(
			"INITIAL_ADMIN_EMAIL",
		);
		expect(() =>
			loadEnvironment({ ...VALID_ENVIRONMENT, INITIAL_ADMIN_PASSWORD: "short" }),
		).toThrow("INITIAL_ADMIN_PASSWORD");
		expect(
			loadEnvironment({ ...VALID_ENVIRONMENT, INITIAL_ADMIN_PASSWORD: "password" }),
		).toMatchObject({ initialAdminPassword: "password" });
	});
});
