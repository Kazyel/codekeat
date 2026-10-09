import { Effect, Semaphore } from "effect";
import { z } from "zod";

const RETRY_SECONDS = z.coerce.number().finite().nonnegative();
const DEFAULT_RETRY_DELAY_MS = 1_000;
const WINDOW_MS = 60_000;

export interface GoogleRequestLimits {
	readonly concurrency: number;
	readonly requestsPerMinute: number | null;
	readonly inputTokensPerMinute: number | null;
}

interface AdmittedRequest {
	readonly startedAt: number;
	readonly inputTokens: number;
}

/** Shared by review and judge; provider retries remain owned by the AI SDK. */
export class GeminiModelAdmission {
	private readonly permits: Semaphore.Semaphore;
	private readonly reservation = Semaphore.makeUnsafe(1);
	private readonly requests = new Map<string, AdmittedRequest[]>();
	private blockedUntil = 0;

	constructor(readonly limits: GoogleRequestLimits) {
		this.permits = Semaphore.makeUnsafe(limits.concurrency);
	}

	withRequest<A, E, R>(
		model: string,
		inputTokens: number,
		operation: Effect.Effect<A, E, R>,
	): Effect.Effect<A, E, R> {
		return this.permits.withPermit(
			this.reserve(model, inputTokens).pipe(Effect.flatMap(() => operation)),
		);
	}

	private reserve(model: string, inputTokens: number): Effect.Effect<void> {
		return this.reservation
			.withPermit(Effect.sync(() => this.reserveOrDelay(model, inputTokens)))
			.pipe(
				Effect.flatMap((delay) =>
					delay === 0
						? Effect.void
						: Effect.sleep(Math.min(delay, WINDOW_MS)).pipe(
								Effect.flatMap(() => this.reserve(model, inputTokens)),
							),
				),
			);
	}

	private reserveOrDelay(model: string, inputTokens: number): number {
		const now = Date.now();
		if (this.blockedUntil > now) return this.blockedUntil - now;
		if (this.limits.requestsPerMinute === null && this.limits.inputTokensPerMinute === null)
			return 0;
		const recent = this.recentRequests(model, now);
		this.requests.set(model, recent);
		if (this.exceedsBudget(recent, inputTokens)) return nextWindowDelay(recent, now);
		recent.push({ startedAt: now, inputTokens });
		return 0;
	}

	private recentRequests(model: string, now: number): AdmittedRequest[] {
		return (this.requests.get(model) ?? []).filter(
			(request) => request.startedAt > now - WINDOW_MS,
		);
	}

	private exceedsBudget(recent: readonly AdmittedRequest[], inputTokens: number): boolean {
		const { requestsPerMinute, inputTokensPerMinute } = this.limits;
		return (
			(requestsPerMinute !== null && recent.length >= requestsPerMinute) ||
			(inputTokensPerMinute !== null &&
				recent.reduce((total, request) => total + request.inputTokens, inputTokens) >
					inputTokensPerMinute)
		);
	}

	observeResponse(response: Response): void {
		if (response.status !== 429) return;
		const delay = retryDelay(response.headers.get("retry-after"));
		this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay);
	}
}

function nextWindowDelay(recent: readonly AdmittedRequest[], now: number): number {
	return Math.max(1, (recent[0]?.startedAt ?? now) + WINDOW_MS - now);
}

function retryDelay(header: string | null): number {
	if (header === null) return DEFAULT_RETRY_DELAY_MS;
	const seconds = RETRY_SECONDS.safeParse(header);
	if (seconds.success && Number.isFinite(seconds.data * 1_000)) return seconds.data * 1_000;
	const date = Date.parse(header);
	return Number.isFinite(date) ? Math.max(0, date - Date.now()) : DEFAULT_RETRY_DELAY_MS;
}
