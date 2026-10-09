import { describe, expect, it } from "vitest";

import { reviewTelemetryResponseSchema } from "./api-contracts";

const EVENT = {
	id: "acb8a550-7c20-415a-b509-68ebd27a01f4",
	reviewRunId: "48e47972-79fc-4115-b238-91d97dc79f1a",
	createdAt: "2026-09-03T12:00:00.000Z",
	phase: "generation",
	scope: "operation",
	attemptId: null,
	callId: "call-provider_1",
	unitId: null,
	durationMs: 150,
	outcome: "failed",
	usage: { inputTokens: 10, outputTokens: 2, cacheTokens: 4, costUsdMicros: 0.125 },
	countedInputTokens: 10,
	diffBytes: 50,
	sourceBytes: 300,
	sourceCount: 2,
	requestCount: 1,
	cacheHitCount: 0,
	retryCount: 0,
	peakRssBytes: 1024,
	capacityFailure: false,
};

describe("review telemetry API contract", () => {
	it("accepts paginated metadata with fractional cost and distinguishes missing usage from preflight tokens", () => {
		const parsed = reviewTelemetryResponseSchema.parse({
			events: [EVENT, { ...EVENT, usage: null }],
			nextCursor: "cursor",
		});
		expect(parsed.events[0]?.usage?.costUsdMicros).toBe(0.125);
		expect(parsed.events[1]?.usage).toBeNull();
		expect(parsed.events[1]?.countedInputTokens).toBe(10);
		expect(parsed.nextCursor).toBe("cursor");
	});
	it.each([
		{ ...EVENT, payload: "private source" },
		{ ...EVENT, callId: "src/private.ts" },
		{ ...EVENT, durationMs: -1 },
	])("rejects unsafe or invalid operational metadata", (event) => {
		expect(
			reviewTelemetryResponseSchema.safeParse({ events: [event], nextCursor: null }).success,
		).toBe(false);
	});
});
