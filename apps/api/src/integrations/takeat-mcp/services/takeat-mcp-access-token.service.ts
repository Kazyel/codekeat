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

export class TakeatMcpAccessTokenService {
	private cachedAccessToken: { readonly refreshAt: number; readonly value: string } | null = null;
	private accessTokenRequest: Promise<string> | null = null;

	constructor(
		private readonly tokenUrl: URL,
		private readonly clientId: string,
		private readonly clientSecret: string,
		private readonly logger: Logger,
	) {}

	async getAccessToken(): Promise<string> {
		if (this.cachedAccessToken !== null && Date.now() < this.cachedAccessToken.refreshAt) {
			return this.cachedAccessToken.value;
		}

		if (this.accessTokenRequest === null) {
			this.accessTokenRequest = this.requestAccessToken();
		}

		try {
			return await this.accessTokenRequest;
		} finally {
			this.accessTokenRequest = null;
		}
	}

	invalidate(): void {
		this.cachedAccessToken = null;
	}

	private async requestAccessToken(): Promise<string> {
		const startedAt = performance.now();
		this.logger.info({}, "takeat_mcp.token_request_started");

		let response: Response;

		try {
			response = await fetch(this.tokenUrl, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					grant_type: "client_credentials",
					client_id: this.clientId,
					client_secret: this.clientSecret,
				}),
				signal: AbortSignal.timeout(TAKEAT_MCP_REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			this.logger.error(
				{
					durationMs: elapsedMilliseconds(startedAt),
					err: error,
					errorCode: "request_failed",
				},
				"takeat_mcp.token_request_failed",
			);
			throw new TakeatMcpUnavailableError();
		}
		if (!response.ok) {
			this.logger.error(
				{
					durationMs: elapsedMilliseconds(startedAt),
					errorCode: "http_error",
					statusCode: response.status,
				},
				"takeat_mcp.token_request_failed",
			);
			throw new TakeatMcpUnavailableError();
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch (error) {
			this.logger.error(
				{
					durationMs: elapsedMilliseconds(startedAt),
					err: error,
					errorCode: "invalid_json",
					statusCode: response.status,
				},
				"takeat_mcp.token_request_failed",
			);
			throw new TakeatMcpUnavailableError();
		}

		const result = ACCESS_TOKEN_RESPONSE_SCHEMA.safeParse(body);
		if (!result.success) {
			this.logger.error(
				{
					durationMs: elapsedMilliseconds(startedAt),
					errorCode: "invalid_response",
					statusCode: response.status,
				},
				"takeat_mcp.token_request_failed",
			);
			throw new TakeatMcpUnavailableError();
		}

		const lifetimeMs = result.data.expires_in * MILLISECONDS_PER_SECOND;
		const refreshSkewMs = Math.min(
			MAXIMUM_TOKEN_REFRESH_SKEW_MS,
			lifetimeMs / TOKEN_REFRESH_LIFETIME_DIVISOR,
		);

		this.cachedAccessToken = {
			refreshAt: Date.now() + lifetimeMs - refreshSkewMs,
			value: result.data.access_token,
		};

		this.logger.info(
			{
				durationMs: elapsedMilliseconds(startedAt),
				expiresInSeconds: result.data.expires_in,
			},
			"takeat_mcp.token_request_succeeded",
		);

		return result.data.access_token;
	}
}

function elapsedMilliseconds(startedAt: number): number {
	return Math.round(performance.now() - startedAt);
}
