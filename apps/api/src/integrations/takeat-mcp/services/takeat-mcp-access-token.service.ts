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
		} catch {
			throw new TakeatMcpUnavailableError();
		}
		if (!response.ok) {
			throw new TakeatMcpUnavailableError();
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new TakeatMcpUnavailableError();
		}

		const result = ACCESS_TOKEN_RESPONSE_SCHEMA.safeParse(body);
		if (!result.success) {
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

		return result.data.access_token;
	}
}
