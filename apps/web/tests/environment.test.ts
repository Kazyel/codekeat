import { describe, expect, it } from "vitest";

import { loadDashboardEnvironment } from "../src/app/lib/environment";

const validEnvironment = {
	CODEKEAT_API_URL: "http://api:3001",
	DASHBOARD_API_TOKEN: "dashboard-api-token",
};

describe("loadDashboardEnvironment", () => {
	it("loads the server-only API credentials", () => {
		const environment = loadDashboardEnvironment(validEnvironment);

		expect(environment).toMatchObject({
			codekeatApiUrl: "http://api:3001",
			dashboardApiToken: "dashboard-api-token",
		});
	});

	it("requires the dashboard API token", () => {
		expect(() =>
			loadDashboardEnvironment({ ...validEnvironment, DASHBOARD_API_TOKEN: "" }),
		).toThrow("DASHBOARD_API_TOKEN");
	});
});
