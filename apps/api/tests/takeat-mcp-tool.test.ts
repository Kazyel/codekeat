import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TakeatMcpAccessTokenService, TakeatMcpUnavailableError } from "#integrations/takeat-mcp";

const LOGGER = pino({ level: "silent" });
const TOKEN_URL = new URL("https://mcp.takeat.example/oauth/token");

describe("TakeatMcpAccessTokenService", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("shares concurrent requests and caches the access token", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("access-token"));
		vi.stubGlobal("fetch", fetchMock);
		const provider = createProvider();
		const program = Effect.gen(function* () {
			const tokens = yield* Effect.all(
				[provider.getAccessToken(), provider.getAccessToken()],
				{
					concurrency: "unbounded",
				},
			);
			const cachedToken = yield* provider.getAccessToken();
			return { tokens, cachedToken };
		});

		await expect(Effect.runPromise(program)).resolves.toEqual({
			tokens: ["access-token", "access-token"],
			cachedToken: "access-token",
		});
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledWith(TOKEN_URL, {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "client_credentials",
				client_id: "codekeat",
				client_secret: "client-secret",
			}),
			signal: expect.any(AbortSignal),
		});
	});

	it("renews the token before it expires", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(tokenResponse("first-token"))
			.mockResolvedValueOnce(tokenResponse("second-token"));
		vi.stubGlobal("fetch", fetchMock);
		const provider = createProvider();
		const program = Effect.gen(function* () {
			const firstToken = yield* provider.getAccessToken();
			yield* TestClock.adjust("54 minutes");
			const cachedToken = yield* provider.getAccessToken();
			yield* TestClock.adjust("2 minutes");
			const renewedToken = yield* provider.getAccessToken();
			return { firstToken, cachedToken, renewedToken };
		});

		await expect(
			Effect.runPromise(Effect.provide(program, TestClock.layer())),
		).resolves.toEqual({
			firstToken: "first-token",
			cachedToken: "first-token",
			renewedToken: "second-token",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("invalidates a rejected token without clearing credentials already renewed", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(tokenResponse("expired-token"))
			.mockResolvedValueOnce(tokenResponse("fresh-token"));
		vi.stubGlobal("fetch", fetchMock);
		const provider = createProvider();
		const program = Effect.gen(function* () {
			const expiredToken = yield* provider.getAccessToken();
			yield* provider.invalidate(expiredToken);
			const renewedToken = yield* provider.getAccessToken();
			yield* provider.invalidate(expiredToken);
			const cachedToken = yield* provider.getAccessToken();
			return { expiredToken, renewedToken, cachedToken };
		});

		await expect(Effect.runPromise(program)).resolves.toEqual({
			expiredToken: "expired-token",
			renewedToken: "fresh-token",
			cachedToken: "fresh-token",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("aborts a stalled response body at the deadline and allows a new token request", async () => {
		const stalledResponse = new Response();
		vi.spyOn(stalledResponse, "json").mockImplementation(() => new Promise<never>(() => {}));
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(stalledResponse)
			.mockResolvedValueOnce(tokenResponse("recovered-token"));
		vi.stubGlobal("fetch", fetchMock);
		const provider = createProvider();
		const program = Effect.gen(function* () {
			const attempt = yield* Effect.forkChild(provider.getAccessToken().pipe(Effect.result));
			yield* TestClock.adjust("10 seconds");
			const outcome = yield* Fiber.join(attempt);
			const aborted = fetchMock.mock.calls[0]?.[1]?.signal?.aborted;
			const recoveredToken = yield* provider.getAccessToken();
			return { outcome, aborted, recoveredToken };
		});

		await expect(
			Effect.runPromise(Effect.provide(program, TestClock.layer())),
		).resolves.toMatchObject({
			outcome: { _tag: "Failure", failure: expect.any(TakeatMcpUnavailableError) },
			aborted: true,
			recoveredToken: "recovered-token",
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it.each([
		["http_error", () => Promise.resolve(new Response("private response", { status: 503 }))],
		[
			"invalid_json",
			() => Promise.resolve(new Response("private invalid JSON", { status: 200 })),
		],
		[
			"invalid_response",
			() =>
				Promise.resolve(
					Response.json({ access_token: "private-token", expires_in: "3600" }),
				),
		],
		["request_failed", () => Promise.reject(new Error("private transport error"))],
	])(
		"does not cache %s failures or log sensitive response data",
		async (errorCode, failRequest) => {
			const error = vi.spyOn(LOGGER, "error");
			const fetchMock = vi
				.fn<typeof fetch>()
				.mockImplementationOnce(failRequest)
				.mockResolvedValueOnce(tokenResponse("recovered-token"));
			vi.stubGlobal("fetch", fetchMock);
			const provider = createProvider();

			await expect(Effect.runPromise(provider.getAccessToken())).rejects.toThrow(
				TakeatMcpUnavailableError,
			);
			await expect(Effect.runPromise(provider.getAccessToken())).resolves.toBe(
				"recovered-token",
			);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(error).toHaveBeenCalledWith(
				expect.objectContaining({ errorCode, durationMs: expect.any(Number) }),
				"takeat_mcp.token_request_failed",
			);
			expect(JSON.stringify(error.mock.calls)).not.toContain("private");
			expect(JSON.stringify(error.mock.calls)).not.toContain("client-secret");
		},
	);
});

function createProvider(): TakeatMcpAccessTokenService {
	return new TakeatMcpAccessTokenService(TOKEN_URL, "codekeat", "client-secret", LOGGER);
}

function tokenResponse(accessToken: string): Response {
	return Response.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3_600 });
}
