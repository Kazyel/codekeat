import { createHash } from "node:crypto";
import { Cache, Context, Data, Effect, Exit } from "effect";
import { z } from "zod";

import {
	GeminiModelAdmission,
	type GoogleRequestLimits,
} from "./gemini-model-admission.service.js";
import {
	captureModelMetrics,
	type CapturedModelMetrics,
} from "../utils/review-model-metrics.util.js";

const REQUEST_TIMEOUT_MS = 10_000;
const GENERATION_TIMEOUT_MS = 5 * 60 * 1_000;
const MODEL_SCHEMA = z.object({ inputTokenLimit: z.number().int().positive() });
const COUNT_SCHEMA = z.object({ totalTokens: z.number().int().nonnegative() });
const GENERATION_BODY_SCHEMA = z.object({ contents: z.array(z.json()) }).catchall(z.json());
type GenerationBody = z.infer<typeof GENERATION_BODY_SCHEMA>;

import { ReviewContextCapacityExceeded } from "#features/review";
export { ReviewContextCapacityExceeded } from "#features/review";

class GoogleContextCapacityUnavailable extends Data.TaggedError(
	"GoogleContextCapacityUnavailable",
) {}

class TokenCountRequest extends Context.Service<
	TokenCountRequest,
	{ readonly model: string; readonly body: string; readonly requested: () => void }
>()("codekeat/GoogleTokenCountRequest") {}

/** Preflight the actual SDK wire request, including tool schemas and conversation history. */
export function createGoogleContextCapacityFetch(
	fetcher: typeof fetch,
	apiKey: string,
): typeof fetch {
	return createGoogleContextCapacityClient(fetcher, apiKey).fetch;
}

export interface GoogleContextCapacityClient {
	readonly fetch: typeof fetch;
	getModelCapacity(
		model: string,
		signal: AbortSignal,
	): Promise<{ readonly inputTokenLimit: number }>;
}

export function createGoogleContextCapacityClient(
	fetcher: typeof fetch,
	apiKey: string,
	limits: GoogleRequestLimits = {
		concurrency: 5,
		requestsPerMinute: null,
		inputTokensPerMinute: null,
	},
): GoogleContextCapacityClient {
	const admission = new GeminiModelAdmission(limits);
	const capacity = new GoogleContextCapacityService(fetcher, apiKey, limits.inputTokensPerMinute);
	const guarded: typeof fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : input.toString());
		const model = /^\/v1beta\/(models\/[^/:]+):generateContent$/.exec(url.pathname)?.[1];
		if (model === undefined) return fetcher(input, init);
		const metrics = captureModelMetrics();
		const body = await generationBody(input, init);
		const signal = requestSignal(input, init);
		const inputTokens = await Effect.runPromise(capacity.check(model, body, metrics), {
			signal,
		});
		const queuedAt = performance.now();
		let admitted = false;
		return Effect.runPromise(
			admission
				.withRequest(
					model,
					inputTokens,
					Effect.tryPromise({
						try: async (requestSignal) => {
							admitted = true;
							metrics.record({
								phase: "queue",
								durationMs: performance.now() - queuedAt,
								outcome: "success",
							});
							return generateRequest(
								fetcher,
								input,
								init,
								requestSignal,
								admission,
								metrics,
							);
						},
						catch: (error) =>
							error instanceof Error
								? error
								: new Error("The provider request failed."),
					}).pipe(
						// Quota and cooldown waits belong to the resumable run slice, not provider I/O.
						Effect.timeoutOrElse({
							duration: GENERATION_TIMEOUT_MS,
							orElse: () => Effect.fail(new Error("The provider request timed out.")),
						}),
					),
				)
				.pipe(
					Effect.onExit((exit) =>
						Effect.sync(() => {
							if (!admitted)
								metrics.record({
									phase: "queue",
									durationMs: performance.now() - queuedAt,
									outcome: Exit.hasInterrupts(exit) ? "cancelled" : "failed",
								});
						}),
					),
				),
			{ signal },
		);
	};
	return {
		fetch: guarded,
		getModelCapacity: (model, signal) =>
			Effect.runPromise(
				capacity
					.getModelCapacity(model.startsWith("models/") ? model : `models/${model}`)
					.pipe(Effect.map((inputTokenLimit) => ({ inputTokenLimit }))),
				{ signal },
			),
	};
}

async function generateRequest(
	fetcher: typeof fetch,
	input: Parameters<typeof fetch>[0],
	init: RequestInit | undefined,
	signal: AbortSignal,
	admission: GeminiModelAdmission,
	metrics: CapturedModelMetrics,
): Promise<Response> {
	const startedAt = performance.now();
	const retryCount = metrics.requestAttempt();
	try {
		const response = await fetcher(input, { ...init, signal });
		admission.observeResponse(response);
		// generateContent is non-streaming. Retain admission until the body completes.
		const bytes = response.body === null ? null : await response.arrayBuffer();
		metrics.record({
			phase: metrics.phase,
			durationMs: performance.now() - startedAt,
			outcome: response.ok ? "success" : "failed",
			requestCount: 1,
			retryCount,
		});
		return new Response(bytes, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	} catch (error) {
		metrics.record({
			phase: metrics.phase,
			durationMs: performance.now() - startedAt,
			outcome: signal.aborted ? "cancelled" : "failed",
			requestCount: 1,
			retryCount,
		});
		throw error;
	}
}

class GoogleContextCapacityService {
	private readonly capacities: Cache.Cache<string, number, GoogleContextCapacityUnavailable>;
	private readonly counts: Cache.Cache<
		string,
		number,
		GoogleContextCapacityUnavailable,
		TokenCountRequest
	>;
	constructor(
		private readonly fetcher: typeof fetch,
		private readonly apiKey: string,
		private readonly inputTokensPerMinute: number | null,
	) {
		this.capacities = Effect.runSync(
			Cache.makeWith((model: string) => this.readCapacity(model), {
				capacity: 100,
				timeToLive: (exit) => (Exit.isSuccess(exit) ? "1 hour" : 0),
			}),
		);
		this.counts = Effect.runSync(
			Cache.makeWith(() => this.readCount(), {
				capacity: 256,
				timeToLive: (exit) => (Exit.isSuccess(exit) ? "10 minutes" : 0),
				requireServicesAt: "lookup",
			}),
		);
	}

	check(
		model: string,
		body: GenerationBody,
		metrics: CapturedModelMetrics,
	): Effect.Effect<number, GoogleContextCapacityUnavailable | ReviewContextCapacityExceeded> {
		return Effect.gen({ self: this }, function* () {
			const inputTokenLimit = yield* this.getModelCapacity(model);
			const countBody = JSON.stringify({
				generateContentRequest: { ...body, model },
			});
			// Retain only the digest and count; the full payload belongs to the lookup fiber.
			const key = createHash("sha256").update(countBody).digest("hex");
			const startedAt = performance.now();
			let requested = false;
			const inputTokens = yield* Cache.get(this.counts, key).pipe(
				Effect.provideService(TokenCountRequest, {
					model,
					body: countBody,
					requested: () => {
						requested = true;
					},
				}),
				Effect.onExit((exit) =>
					Effect.sync(() =>
						recordCountMetric(exit, requested, inputTokenLimit, startedAt, metrics),
					),
				),
			);
			if (inputTokens > inputTokenLimit) {
				return yield* Effect.fail(
					new ReviewContextCapacityExceeded({
						inputTokens,
						inputTokenLimit,
					}),
				);
			}
			return inputTokens;
		});
	}

	getModelCapacity(model: string): Effect.Effect<number, GoogleContextCapacityUnavailable> {
		return Cache.get(this.capacities, model).pipe(
			Effect.map((limit) => Math.min(limit, this.inputTokensPerMinute ?? limit)),
		);
	}

	private readCount(): Effect.Effect<
		number,
		GoogleContextCapacityUnavailable,
		TokenCountRequest
	> {
		return Effect.gen({ self: this }, function* () {
			const request = yield* TokenCountRequest;
			request.requested();
			const response = yield* this.request(`${request.model}:countTokens`, request.body);
			const count = COUNT_SCHEMA.safeParse(response);
			if (!count.success) return yield* Effect.fail(new GoogleContextCapacityUnavailable());
			return count.data.totalTokens;
		});
	}

	private readCapacity(model: string): Effect.Effect<number, GoogleContextCapacityUnavailable> {
		return this.request(model).pipe(
			Effect.flatMap((response) => {
				const parsed = MODEL_SCHEMA.safeParse(response);
				return parsed.success
					? Effect.succeed(parsed.data.inputTokenLimit)
					: Effect.fail(new GoogleContextCapacityUnavailable());
			}),
		);
	}

	private request(
		path: string,
		body?: string,
	): Effect.Effect<z.JSONType, GoogleContextCapacityUnavailable> {
		return Effect.tryPromise({
			try: async (signal) => {
				const response = await this.fetcher(
					`https://generativelanguage.googleapis.com/v1beta/${path}`,
					{
						method: body === undefined ? "GET" : "POST",
						headers: {
							"x-goog-api-key": this.apiKey,
							"Content-Type": "application/json",
						},
						...(body === undefined ? {} : { body }),
						signal,
					},
				);
				if (!response.ok) throw new GoogleContextCapacityUnavailable();
				return z.json().parse(await response.json());
			},
			catch: () => new GoogleContextCapacityUnavailable(),
		}).pipe(
			Effect.timeoutOrElse({
				duration: REQUEST_TIMEOUT_MS,
				orElse: () => Effect.fail(new GoogleContextCapacityUnavailable()),
			}),
		);
	}
}

function recordCountMetric(
	exit: Exit.Exit<number, GoogleContextCapacityUnavailable>,
	requested: boolean,
	limit: number,
	startedAt: number,
	metrics: CapturedModelMetrics,
): void {
	const metric = {
		phase: "count",
		durationMs: performance.now() - startedAt,
		requestCount: Number(requested),
	} as const;
	if (Exit.isFailure(exit)) {
		metrics.record({
			...metric,
			outcome: Exit.hasInterrupts(exit) ? "cancelled" : "failed",
		});
		return;
	}
	metrics.record({
		...metric,
		outcome: "success",
		countedInputTokens: exit.value,
		cacheHitCount: Number(!requested),
		capacityFailure: exit.value > limit,
	});
}

async function generationBody(
	input: Parameters<typeof fetch>[0],
	init: RequestInit | undefined,
): Promise<GenerationBody> {
	const body = await requestBody(input, init);
	if (typeof body !== "string") throw new GoogleContextCapacityUnavailable();
	try {
		return GENERATION_BODY_SCHEMA.parse(JSON.parse(body));
	} catch {
		throw new GoogleContextCapacityUnavailable();
	}
}

function requestSignal(
	input: Parameters<typeof fetch>[0],
	init: RequestInit | undefined,
): AbortSignal | undefined {
	return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}

function requestBody(
	input: Parameters<typeof fetch>[0],
	init: RequestInit | undefined,
): Promise<RequestInit["body"]> {
	if (init?.body !== undefined && init.body !== null) return Promise.resolve(init.body);
	return input instanceof Request ? input.clone().text() : Promise.resolve(undefined);
}
