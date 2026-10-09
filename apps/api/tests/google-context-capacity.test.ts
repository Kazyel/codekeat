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
	it("counts the entire wire body, accepts the exact limit and caches only model capacity", async () => {
		const { guarded, fetcher, calls } = harness();
		await expect(guarded(URL, INIT)).resolves.toBeInstanceOf(Response);
		await guarded(URL, INIT);
		expect(calls.filter((call) => call.url.endsWith(":countTokens"))).toHaveLength(2);
		expect(calls.filter((call) => call.init?.method === "GET")).toHaveLength(1);
		const count = calls.find((call) => call.url.endsWith(":countTokens"));
		if (typeof count?.init?.body !== "string") throw new Error("Missing token count request");
		expect(z.json().parse(JSON.parse(count.init.body))).toEqual({
			generateContentRequest: { ...BODY, model: "models/gemini-3.8-flash" },
		});
		expect(fetcher).toHaveBeenCalledTimes(5);
		expect(calls.at(-1)).toEqual({ url: URL, init: INIT });
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
		const { guarded, fetcher } = harness();
		await guarded(URL, INIT);
		await vi.advanceTimersByTimeAsync(3_600_001);
		fetcher.mockResolvedValueOnce(Response.json({ inputTokenLimit: 50 }));
		await expect(guarded(URL, INIT)).rejects.toMatchObject({
			inputTokens: 100,
			inputTokenLimit: 50,
		});
	} finally {
		vi.useRealTimers();
	}
});
