const maximumAttempts = 5;
const windowMilliseconds = 15 * 60 * 1000;

export class LoginAttemptLimiter {
  private readonly attemptsByEmail = new Map<string, number[]>();

  allows(email: string, now: number): boolean {
    return this.recentAttempts(email, now).length < maximumAttempts;
  }

  recordFailure(email: string, now: number): void {
    const attempts = this.recentAttempts(email, now);
    attempts.push(now);
    this.attemptsByEmail.set(email, attempts);
  }

  clear(email: string): void {
    this.attemptsByEmail.delete(email);
  }

  private recentAttempts(email: string, now: number): number[] {
    const attempts = this.attemptsByEmail.get(email) ?? [];
    const recent = attempts.filter((attempt) => attempt > now - windowMilliseconds);
    if (recent.length === 0) {
      this.attemptsByEmail.delete(email);
      return recent;
    }
    this.attemptsByEmail.set(email, recent);
    return recent;
  }
}

export const loginAttemptLimiter = new LoginAttemptLimiter();
