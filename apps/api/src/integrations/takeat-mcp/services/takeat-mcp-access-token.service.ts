import { Cache, Effect, Exit } from "effect";
import type { Logger } from "pino";
import { z } from "zod";

import {
	MAXIMUM_TOKEN_REFRESH_SKEW_MS,
	MILLISECONDS_PER_SECOND,
	TAKEAT_MCP_REQUEST_TIMEOUT_MS,
	TOKEN_REFRESH_LIFETIME_DIVISOR,
} from "../constants/takeat-mcp.constants.js";
import { TakeatMcpUnavailableError } from "../errors/takeat-mcp.errors.js";

const ACCESS_TOKEN_RESPONSE_SCHEMA = z.object({
	access_token: z.string().min(1),
	token_type: z
		.string()
		.transform((value) => value.toLowerCase())
		.pipe(z.literal("bearer")),
	expires_in: z.number().int().positive(),
});

interface CachedAccessToken {
	readonly value: string;
	readonly refreshAfterMs: number;
}

type TokenFailureCode =
	| "request_failed"
	| "request_timeout"
	| "http_error"
	| "invalid_json"
	| "invalid_response";

export class TakeatMcpAccessTokenService {
	private readonly accessTokens: Cache.Cache<
		"takeat",
		CachedAccessToken,
		TakeatMcpUnavailableError
	>;

	constructor(
		private readonly tokenUrl: URL,
		private readonly clientId: string,
		private readonly clientSecret: string,
		private readonly logger: Logger,
	) {
		this.accessTokens = Effect.runSync(
			Cache.makeWith<"takeat", CachedAccessToken, TakeatMcpUnavailableError>(
				() => this.requestAccessToken(),
				{
					capacity: 1,
					timeToLive: (exit) => (Exit.isSuccess(exit) ? exit.value.refreshAfterMs : 0),
				},
			),
		);
	}

	getAccessToken(): Effect.Effect<string, TakeatMcpUnavailableError> {
		return Cache.get(this.accessTokens, "takeat").pipe(Effect.map((token) => token.value));
	}

	invalidate(rejectedToken: string): Effect.Effect<void> {
		// A delayed rejection must not invalidate credentials another request already renewed.
		return Cache.invalidateWhen(
			this.accessTokens,
			"takeat",
			(token) => token.value === rejectedToken,
		).pipe(Effect.asVoid);
	}

	private requestAccessToken(): Effect.Effect<CachedAccessToken, TakeatMcpUnavailableError> {
		return Effect.suspend(() => {
			const startedAt = performance.now();
			return Effect.acquireUseRelease(
				Effect.sync(() => new AbortController()),
				(controller) =>
					this.loadAccessToken(startedAt, controller.signal).pipe(
						Effect.timeoutOrElse({
							duration: TAKEAT_MCP_REQUEST_TIMEOUT_MS,
							orElse: () =>
								Effect.fail(
									this.tokenFailure(startedAt, "request_timeout", undefined),
								),
						}),
					),
				(controller) => Effect.sync(() => controller.abort()),
			);
		});
	}

	private loadAccessToken(
		startedAt: number,
		signal: AbortSignal,
	): Effect.Effect<CachedAccessToken, TakeatMcpUnavailableError> {
		return Effect.gen({ self: this }, function* () {
			this.logger.info({}, "takeat_mcp.token_request_started");
			const response = yield* this.fetchAccessToken(startedAt, signal);
			if (!response.ok) {
				return yield* Effect.fail(
					this.tokenFailure(startedAt, "http_error", response.status),
				);
			}

			const body = yield* Effect.tryPromise({
				try: () => response.json(),
				catch: () => this.tokenFailure(startedAt, "invalid_json", response.status),
			});
			const result = ACCESS_TOKEN_RESPONSE_SCHEMA.safeParse(body);
			if (!result.success) {
				return yield* Effect.fail(
					this.tokenFailure(startedAt, "invalid_response", response.status),
				);
			}

			this.logger.info(
				{
					durationMs: Math.round(performance.now() - startedAt),
					expiresInSeconds: result.data.expires_in,
				},
				"takeat_mcp.token_request_succeeded",
			);
			return {
				value: result.data.access_token,
				refreshAfterMs: tokenRefreshDelay(result.data.expires_in),
			};
		});
	}

	private fetchAccessToken(
		startedAt: number,
		signal: AbortSignal,
	): Effect.Effect<Response, TakeatMcpUnavailableError> {
		return Effect.tryPromise({
			try: () =>
				fetch(this.tokenUrl, {
					method: "POST",
					headers: { Accept: "application/json", "Content-Type": "application/json" },
					body: JSON.stringify({
						grant_type: "client_credentials",
						client_id: this.clientId,
						client_secret: this.clientSecret,
					}),
					signal,
				}),
			catch: () => this.tokenFailure(startedAt, "request_failed", undefined),
		});
	}

	private tokenFailure(
		startedAt: number,
		errorCode: TokenFailureCode,
		statusCode: number | undefined,
	): TakeatMcpUnavailableError {
		this.logger.error(
			{ durationMs: Math.round(performance.now() - startedAt), errorCode, statusCode },
			"takeat_mcp.token_request_failed",
		);
		return new TakeatMcpUnavailableError();
	}
}

function tokenRefreshDelay(expiresInSeconds: number): number {
	const lifetimeMs = expiresInSeconds * MILLISECONDS_PER_SECOND;
	const refreshSkewMs = Math.min(
		MAXIMUM_TOKEN_REFRESH_SKEW_MS,
		lifetimeMs / TOKEN_REFRESH_LIFETIME_DIVISOR,
	);
	return lifetimeMs - refreshSkewMs;
}
