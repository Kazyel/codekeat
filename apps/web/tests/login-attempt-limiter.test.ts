import { describe, expect, it } from "vitest";

import { LoginAttemptLimiter } from "../src/app/lib/login-attempt-limiter";

describe("LoginAttemptLimiter", () => {
  it("blocks a sixth failed attempt during the configured window", () => {
    const limiter = new LoginAttemptLimiter();
    const now = Date.UTC(2026, 7, 11);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.allows("admin@codekeat.local", now)).toBe(true);
      limiter.recordFailure("admin@codekeat.local", now);
    }

    expect(limiter.allows("admin@codekeat.local", now)).toBe(false);
  });

  it("allows new attempts after the window expires or a successful login", () => {
    const limiter = new LoginAttemptLimiter();
    const now = Date.UTC(2026, 7, 11);

    limiter.recordFailure("admin@codekeat.local", now);
    limiter.clear("admin@codekeat.local");
    expect(limiter.allows("admin@codekeat.local", now)).toBe(true);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.recordFailure("admin@codekeat.local", now);
    }
    expect(limiter.allows("admin@codekeat.local", now + 15 * 60 * 1000 + 1)).toBe(true);
  });
});
