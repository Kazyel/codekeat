import { describe, expect, it } from "vitest";

import { isAllowedGithubAccount } from "#features/github";

describe("isAllowedGithubAccount", () => {
	it("accepts an allowed personal account without case sensitivity", () => {
		expect(isAllowedGithubAccount("MateusMascarelo", new Set(["mateusmascarelo"]))).toBe(true);
	});

	it("rejects an account outside the allowlist", () => {
		expect(isAllowedGithubAccount("another-user", new Set(["takeat"]))).toBe(false);
	});
});
