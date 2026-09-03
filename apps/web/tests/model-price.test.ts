import { describe, expect, it } from "vitest";

import { usdPerMillionToNanoUsdPerToken } from "../src/app/dashboard/models/model-price";

describe("usdPerMillionToNanoUsdPerToken", () => {
	it.each([
		["0.07", 70],
		["0.57", 570],
		["1.14", 1_140],
		["3.750", 3_750],
	])("converts %s without floating-point residue", (value, expected) => {
		expect(usdPerMillionToNanoUsdPerToken(value)).toBe(expected);
	});
});
