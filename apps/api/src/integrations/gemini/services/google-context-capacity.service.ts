import { Cache, Data, Effect, Exit } from "effect";
import { z } from "zod";

const REQUEST_TIMEOUT_MS = 10_000;
const MODEL_SCHEMA = z.object({ inputTokenLimit: z.number().int().positive() });
const COUNT_SCHEMA = z.object({ totalTokens: z.number().int().nonnegative() });
const GENERATION_BODY_SCHEMA = z.object({ contents: z.array(z.json()) }).catchall(z.json());
type GenerationBody = z.infer<typeof GENERATION_BODY_SCHEMA>;

import { ReviewContextCapacityExceeded } from "#features/review";
export { ReviewContextCapacityExceeded } from "#features/review";

class GoogleContextCapacityUnavailable extends Data.TaggedError(
	"GoogleContextCapacityUnavailable",
) {}

/** Preflight the actual SDK wire request, including tool schemas and conversation history. */
export function createGoogleContextCapacityFetch(
	fetcher: typeof fetch,
	apiKey: string,
): typeof fetch {
	const capacity = new GoogleContextCapacityService(fetcher, apiKey);
	return async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : input.toString());
		const model = /^\/v1beta\/(models\/[^/:]+):generateContent$/.exec(url.pathname)?.[1];
		if (model === undefined) return fetcher(input, init);
		const body = await generationBody(input, init);
		const signal = requestSignal(input, init);
		await Effect.runPromise(capacity.check(model, body), { signal });
		return fetcher(input, init);
	};
}

class GoogleContextCapacityService {
	private readonly capacities: Cache.Cache<string, number, GoogleContextCapacityUnavailable>;
	constructor(
		private readonly fetcher: typeof fetch,
		private readonly apiKey: string,
	) {
		this.capacities = Effect.runSync(
			Cache.makeWith((model: string) => this.readCapacity(model), {
				capacity: 100,
				timeToLive: (exit) => (Exit.isSuccess(exit) ? "1 hour" : 0),
			}),
		);
	}

	check(
		model: string,
		body: GenerationBody,
	): Effect.Effect<void, GoogleContextCapacityUnavailable | ReviewContextCapacityExceeded> {
		return Effect.gen({ self: this }, function* () {
			const inputTokenLimit = yield* Cache.get(this.capacities, model);
			const response = yield* this.request(`${model}:countTokens`, {
				generateContentRequest: { ...body, model },
			});
			const count = COUNT_SCHEMA.safeParse(response);
			if (!count.success) return yield* Effect.fail(new GoogleContextCapacityUnavailable());
			if (count.data.totalTokens > inputTokenLimit) {
				return yield* Effect.fail(
					new ReviewContextCapacityExceeded({
						inputTokens: count.data.totalTokens,
						inputTokenLimit,
					}),
				);
			}
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
		body?: { readonly generateContentRequest: GenerationBody & { readonly model: string } },
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
						...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
