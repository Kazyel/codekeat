import { describe, expect, it } from "vitest";

import { loadEnvironment } from "@/bootstrap/environment";

describe("loadEnvironment", () => {
	it("normalizes a valid API origin and keeps the internal bearer token server-side", () => {
		const environment = loadEnvironment({
			CODEKEAT_API_URL: " https://api.example.com/base ",
			DASHBOARD_API_TOKEN: " internal-token ",
		});

		expect(environment.apiUrl.href).toBe("https://api.example.com/base");
		expect(environment.dashboardApiToken).toBe("internal-token");
	});

	it("rejects missing and malformed boundary values", () => {
		expect(() => loadEnvironment({ CODEKEAT_API_URL: "not-a-url" })).toThrow("Invalid URL");
		expect(() => loadEnvironment({ CODEKEAT_API_URL: "https://api.example.com" })).toThrow(
			"DASHBOARD_API_TOKEN",
		);
	});
});
