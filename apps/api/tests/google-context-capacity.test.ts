import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
	createGoogleContextCapacityFetch,
	ReviewContextCapacityExceeded,
} from "#integrations/gemini";

const URL =
	"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";
const BODY = {
	contents: [{ role: "user", parts: [{ text: "Complete source code" }] }],
	systemInstruction: { parts: [{ text: "Review system instructions" }] },
	tools: [{ functionDeclarations: [{ name: "read_file", parameters: { type: "OBJECT" } }] }],
	generationConfig: {
		responseMimeType: "application/json",
		responseJsonSchema: { type: "object" },
	},
};
const INIT = { method: "POST", body: JSON.stringify(BODY) };

function harness(tokens = 100, limit = 100) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
		calls.push({ url: url.toString(), init });
		if (url.toString().endsWith(":countTokens")) return Response.json({ totalTokens: tokens });
		if (url.toString().endsWith(":generateContent")) return Response.json({ generated: true });
		return Response.json({ inputTokenLimit: limit });
	});
	return { fetcher, calls, guarded: createGoogleContextCapacityFetch(fetcher, "test-api-key") };
}

describe("Google context capacity", () => {
	afterEach(() => vi.useRealTimers());
	it("counts the entire wire body once while forwarding every identical generation", async () => {
		const { guarded, fetcher, calls } = harness();
		await expect(guarded(URL, INIT)).resolves.toBeInstanceOf(Response);
		for (let index = 1; index < 20; index++) await guarded(URL, INIT);
		expect(calls.filter((call) => call.url.endsWith(":countTokens"))).toHaveLength(1);
		expect(calls.filter((call) => call.init?.method === "GET")).toHaveLength(1);
		const count = calls.find((call) => call.url.endsWith(":countTokens"));
		if (typeof count?.init?.body !== "string") throw new Error("Missing token count request");
		expect(z.json().parse(JSON.parse(count.init.body))).toEqual({
			generateContentRequest: { ...BODY, model: "models/gemini-3.8-flash" },
		});
		expect(calls.filter((call) => call.url.endsWith(":generateContent"))).toHaveLength(20);
		expect(fetcher).toHaveBeenCalledTimes(22);
		expect(calls.at(-1)).toEqual({ url: URL, init: INIT });
	});
	it("shares an in-flight count without cancelling another caller's generation", async () => {
		const { guarded, fetcher, calls } = harness();
		const counting = Promise.withResolvers<Response>();
		let countSignal: AbortSignal | null | undefined;
		fetcher
			.mockResolvedValueOnce(Response.json({ inputTokenLimit: 100 }))
			.mockImplementationOnce((_url, init) => {
				countSignal = init?.signal;
				return counting.promise;
			});
		const parent = new AbortController();
		const cancelled = guarded(URL, { ...INIT, signal: parent.signal }).catch(
			(error: unknown) => error,
		);
		await vi.waitFor(() => expect(countSignal).toBeDefined());
		const surviving = guarded(URL, INIT);
		await new Promise<void>((resolve) => setImmediate(resolve));
		parent.abort();
		expect(await cancelled).toBeInstanceOf(Error);
		expect(countSignal?.aborted).toBe(false);
		counting.resolve(Response.json({ totalTokens: 100 }));
		await expect(surviving).resolves.toBeInstanceOf(Response);
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(calls.filter((call) => call.url.endsWith(":generateContent"))).toHaveLength(1);
	});
	it.each([
		{ name: "system", body: { ...BODY, systemInstruction: { parts: [{ text: "Changed" }] } } },
		{
			name: "tools",
			body: { ...BODY, tools: [{ functionDeclarations: [{ name: "search" }] }] },
		},
		{
			name: "schema",
			body: {
				...BODY,
				generationConfig: {
					...BODY.generationConfig,
					responseJsonSchema: { type: "array" },
				},
			},
		},
		{
			name: "tool history",
			body: {
				...BODY,
				contents: [
					...BODY.contents,
					{
						role: "user",
						parts: [
							{
								functionResponse: {
									name: "read_file",
									response: { text: "Evidence" },
								},
							},
						],
					},
				],
			},
		},
	])("recounts changes to $name instead of reusing a stale count", async ({ body }) => {
		const { guarded, calls } = harness();
		await guarded(URL, INIT);
		await guarded(URL, { ...INIT, body: JSON.stringify(body) });
		expect(calls.filter((call) => call.url.endsWith(":countTokens"))).toHaveLength(2);
	});
	it("isolates counts by model and by authenticated guard instance", async () => {
		const { guarded, fetcher, calls } = harness();
		await guarded(URL, INIT);
		await guarded(URL.replace("gemini-3.8-flash", "another-model"), INIT);
		const otherGuard = createGoogleContextCapacityFetch(fetcher, "another-api-key");
		await otherGuard(URL, INIT);
		expect(calls.filter((call) => call.url.endsWith(":countTokens"))).toHaveLength(3);
	});
	it.each([503, "invalid"] as const)("retries a failed token count (%s)", async (failure) => {
		const { guarded, fetcher } = harness();
		fetcher
			.mockResolvedValueOnce(Response.json({ inputTokenLimit: 100 }))
			.mockResolvedValueOnce(
				failure === "invalid" ? Response.json({}) : new Response(null, { status: failure }),
			);
		await expect(guarded(URL, INIT)).rejects.not.toBeInstanceOf(ReviewContextCapacityExceeded);
		await expect(guarded(URL, INIT)).resolves.toBeInstanceOf(Response);
		expect(fetcher).toHaveBeenCalledTimes(4);
	});
	it("expires token counts after ten minutes without discarding valid metadata", async () => {
		vi.useFakeTimers();
		const { guarded, calls } = harness();
		await guarded(URL, INIT);
		await vi.advanceTimersByTimeAsync(600_001);
		await guarded(URL, INIT);
		expect(calls.filter((call) => call.url.endsWith(":countTokens"))).toHaveLength(2);
		expect(calls.filter((call) => call.init?.method === "GET")).toHaveLength(1);
	});
	it("rejects excess input before generation without truncating it", async () => {
		const { guarded, calls } = harness(101);
		await expect(guarded(URL, INIT)).rejects.toMatchObject({
			inputTokens: 101,
			inputTokenLimit: 100,
		});
		expect(calls.some((call) => call.url.endsWith(":generateContent"))).toBe(false);
	});
	it("preserves unrelated HTTP failures instead of classifying them as context overflow", async () => {
		const { guarded, fetcher } = harness();
		fetcher
			.mockResolvedValueOnce(Response.json({ inputTokenLimit: 100 }))
			.mockResolvedValueOnce(Response.json({ totalTokens: 10 }))
			.mockResolvedValueOnce(new Response("Invalid request", { status: 400 }));
		const response = await guarded(URL, INIT);
		expect(response.status).toBe(400);
	});
	it("does not cache a failed model metadata request", async () => {
		const { guarded, fetcher } = harness();
		fetcher.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
		await expect(guarded(URL, INIT)).rejects.not.toBeInstanceOf(ReviewContextCapacityExceeded);
		await expect(guarded(URL, INIT)).resolves.toBeInstanceOf(Response);
		expect(fetcher).toHaveBeenCalledTimes(4);
	});
	it.each(["metadata", "count"] as const)(
		"aborts a stalled %s body at the ten-second deadline",
		async (kind) => {
			vi.useFakeTimers();
			let observedSignal: AbortSignal | null | undefined;
			const { guarded, fetcher } = harness();
			if (kind === "count")
				fetcher.mockResolvedValueOnce(Response.json({ inputTokenLimit: 100 }));
			fetcher.mockImplementationOnce(async (_url, init) => {
				observedSignal = init?.signal;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							init?.signal?.addEventListener(
								"abort",
								() => controller.error(new DOMException("Aborted", "AbortError")),
								{ once: true },
							);
						},
					}),
				);
			});
			const outcome = guarded(URL, INIT).catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(10_001);
			expect(await outcome).toBeInstanceOf(Error);
			expect(observedSignal?.aborted).toBe(true);
		},
	);
	it("propagates parent cancellation during token counting", async () => {
		const parent = new AbortController();
		let observedSignal: AbortSignal | null | undefined;
		const { guarded, fetcher } = harness();
		fetcher
			.mockResolvedValueOnce(Response.json({ inputTokenLimit: 100 }))
			.mockImplementationOnce(async (_url, init) => {
				observedSignal = init?.signal;
				return new Promise<Response>((_resolve, reject) =>
					init?.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					),
				);
			});
		const outcome = guarded(URL, { ...INIT, signal: parent.signal }).catch(
			(error: unknown) => error,
		);
		await vi.waitFor(() => expect(observedSignal).toBeDefined());
		parent.abort();
		expect(await outcome).toBeInstanceOf(Error);
		expect(observedSignal?.aborted).toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});

it("refreshes model capacity after its one-hour TTL", async () => {
	vi.useFakeTimers();
	try {
		const { guarded, fetcher, calls } = harness();
		await guarded(URL, INIT);
		await vi.advanceTimersByTimeAsync(3_540_000);
		await guarded(URL, INIT);
		await vi.advanceTimersByTimeAsync(60_001);
		fetcher.mockResolvedValueOnce(Response.json({ inputTokenLimit: 50 }));
		await expect(guarded(URL, INIT)).rejects.toMatchObject({
			inputTokens: 100,
			inputTokenLimit: 50,
		});
		expect(calls.filter((call) => call.url.endsWith(":countTokens"))).toHaveLength(2);
	} finally {
		vi.useRealTimers();
	}
});
