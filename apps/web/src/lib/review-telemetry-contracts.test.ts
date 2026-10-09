import { describe, expect, it } from "vitest";

import {
	reviewTelemetryResponseSchema,
	reviewTelemetrySummaryResponseSchema,
} from "./api-contracts";

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
	it("preserves partial reasoning coverage in summaries and accepts historical responses without it", () => {
		const summary = {
			period: "2026-10-09",
			phase: "generation",
			scope: "operation",
			sizeBand: "small",
			sampleCount: 3,
			runCount: 1,
			p50DurationMs: 20,
			p95DurationMs: 50,
			failureCount: 0,
			cancelledCount: 0,
			ignoredCount: 0,
			requestCount: 3,
			cacheHitCount: 0,
			retryCount: 0,
			capacityFailureCount: 0,
			peakRssBytes: 1024,
			knownUsageCount: 2,
			usage: { inputTokens: 20, outputTokens: 4, cacheTokens: 8, costUsdMicros: 0.25 },
		};
		const parsed = reviewTelemetrySummaryResponseSchema.parse({
			days: 30,
			summaries: [summary, { ...summary, knownReasoningCount: 1, reasoningTokens: 1 }],
		});
		expect(
			parsed.summaries.map(({ reasoningTokens, knownReasoningCount }) => ({
				reasoningTokens,
				knownReasoningCount,
			})),
		).toEqual([
			{ reasoningTokens: null, knownReasoningCount: 0 },
			{ reasoningTokens: 1, knownReasoningCount: 1 },
		]);
	});
	it("accepts paginated metadata with fractional cost and distinguishes missing usage from preflight tokens", () => {
		const parsed = reviewTelemetryResponseSchema.parse({
			events: [
				{ ...EVENT, reasoningTokens: 1 },
				{ ...EVENT, usage: null },
			],
			nextCursor: "cursor",
		});
		expect(parsed.events[0]?.usage?.costUsdMicros).toBe(0.125);
		expect(parsed.events[0]?.reasoningTokens).toBe(1);
		expect(parsed.events[1]?.reasoningTokens).toBeNull();
		expect(parsed.events[1]?.usage).toBeNull();
		expect(parsed.events[1]?.countedInputTokens).toBe(10);
		expect(parsed.nextCursor).toBe("cursor");
	});
	it.each([
		{ ...EVENT, payload: "private source" },
		{ ...EVENT, callId: "src/private.ts" },
		{ ...EVENT, durationMs: -1 },
		{ ...EVENT, reasoningTokens: -1 },
		{ ...EVENT, reasoningTokens: 3 },
		{ ...EVENT, reasoningTokens: 0, usage: null },
	])("rejects unsafe or invalid operational metadata", (event) => {
		expect(
			reviewTelemetryResponseSchema.safeParse({ events: [event], nextCursor: null }).success,
		).toBe(false);
	});
});
