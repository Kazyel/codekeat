import { describe, expect, it } from "vitest";

import { formatTokenPricePerMillion } from "./format";

describe("formatTokenPricePerMillion", () => {
	it("converts nano USD per token into USD per million tokens", () => {
		expect([750, 75, 3750].map(formatTokenPricePerMillion)).toEqual([
			"$0.75",
			"$0.075",
			"$3.75",
		]);
	});
});
