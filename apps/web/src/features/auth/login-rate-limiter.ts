interface LoginAttempt {
	failures: number;
	resetAt: number;
}

export class LoginRateLimiter {
	readonly #limit: number;
	readonly #windowMs: number;
	readonly #attempts = new Map<string, LoginAttempt>();

	constructor(limit: number, windowMs: number) {
		this.#limit = limit;
		this.#windowMs = windowMs;
	}

	mayAttempt(key: string, now: number): boolean {
		const attempt = this.#attempts.get(key);
		if (!attempt || attempt.resetAt <= now) {
			this.#attempts.delete(key);
			return true;
		}
		return attempt.failures < this.#limit;
	}

	recordFailure(key: string, now: number): void {
		const attempt = this.#attempts.get(key);
		if (!attempt || attempt.resetAt <= now) {
			this.#attempts.set(key, { failures: 1, resetAt: now + this.#windowMs });
			return;
		}
		attempt.failures += 1;
	}

	clear(key: string): void {
		this.#attempts.delete(key);
	}
}
