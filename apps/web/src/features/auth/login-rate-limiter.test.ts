import { describe, expect, it } from "vitest";

import { LoginRateLimiter } from "@/features/auth/login-rate-limiter";

describe("LoginRateLimiter", () => {
	it("blocks an identity after the configured number of failures", () => {
		const limiter = new LoginRateLimiter(5, 15 * 60_000);

		for (let attempt = 0; attempt < 5; attempt += 1) {
			expect(limiter.mayAttempt("admin@example.com", 1_000)).toBe(true);
			limiter.recordFailure("admin@example.com", 1_000);
		}

		expect(limiter.mayAttempt("admin@example.com", 1_000)).toBe(false);
		expect(limiter.mayAttempt("member@example.com", 1_000)).toBe(true);
	});

	it("opens a new window when the previous window expires", () => {
		const limiter = new LoginRateLimiter(1, 500);
		limiter.recordFailure("admin@example.com", 1_000);

		expect(limiter.mayAttempt("admin@example.com", 1_499)).toBe(false);
		expect(limiter.mayAttempt("admin@example.com", 1_500)).toBe(true);
	});

	it("clears failures after a successful login", () => {
		const limiter = new LoginRateLimiter(1, 500);
		limiter.recordFailure("admin@example.com", 1_000);
		limiter.clear("admin@example.com");

		expect(limiter.mayAttempt("admin@example.com", 1_001)).toBe(true);
	});
});
