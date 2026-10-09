import { describe, expect, it } from "vitest";

import { mergeAnalytics } from "./analytics-data";

describe("analytics chart data", () => {
	it("counts cached input once when combining repository usage for a period", () => {
		const points = mergeAnalytics(
			[
				{
					period: "2026-09-03",
					repositoryFullName: "takeat/api",
					inputTokens: 100,
					outputTokens: 20,
					cacheTokens: 30,
					costUsdMicros: 150,
				},
				{
					period: "2026-09-03",
					repositoryFullName: "takeat/web",
					inputTokens: 50,
					outputTokens: 10,
					cacheTokens: 5,
					costUsdMicros: 75,
				},
			],
			[],
		);

		expect(points).toMatchObject([
			{
				period: "2026-09-03",
				tokens: 180,
				cost: 225,
			},
		]);
	});
});
