import { z } from "zod";

const count = z.number().int().nonnegative();
const nullableCount = count.nullable();
const opaqueId = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,160}$/)
	.nullable();

export const reviewMetricSchema = z
	.object({
		phase: z.enum(["queue", "input", "prepare", "count", "generation", "tool", "judge"]),
		scope: z.enum(["phase", "operation"]),
		attemptId: opaqueId,
		callId: opaqueId,
		unitId: opaqueId,
		durationMs: count,
		outcome: z.enum(["success", "failed", "ignored", "cancelled"]),
		usage: z
			.object({
				inputTokens: count,
				outputTokens: count,
				cacheTokens: count,
				costUsdMicros: z.number().nonnegative(),
			})
			.strict()
			.nullable(),
		countedInputTokens: nullableCount,
		diffBytes: nullableCount,
		sourceBytes: nullableCount,
		sourceCount: nullableCount,
		requestCount: count,
		cacheHitCount: count,
		retryCount: count,
		peakRssBytes: count,
		capacityFailure: z.boolean(),
	})
	.strict();

export type ReviewMetric = z.infer<typeof reviewMetricSchema>;
export type ReviewMetricRecorder = (metric: ReviewMetric) => void;
export type ReviewMetricPhase = ReviewMetric["phase"];
export type ReviewSizeBand = "small" | "medium" | "large" | "unknown";

/** Defaults describe inapplicable counters, while unknown source sizes and usage stay null. */
export function createReviewMetric(
	input: Pick<ReviewMetric, "phase" | "durationMs" | "outcome"> &
		Partial<Omit<ReviewMetric, "phase" | "durationMs" | "outcome">>,
): ReviewMetric {
	return reviewMetricSchema.parse({
		scope: "operation",
		attemptId: null,
		callId: null,
		unitId: null,
		usage: null,
		countedInputTokens: null,
		diffBytes: null,
		sourceBytes: null,
		sourceCount: null,
		requestCount: 0,
		cacheHitCount: 0,
		retryCount: 0,
		peakRssBytes: Math.max(process.memoryUsage().rss, process.resourceUsage().maxRSS * 1_024),
		capacityFailure: false,
		...input,
		durationMs: Math.max(0, Math.round(input.durationMs)),
	});
}

export const reviewMetricEventSchema = reviewMetricSchema.extend({
	id: z.uuid(),
	reviewRunId: z.uuid(),
	createdAt: z.iso.datetime(),
});
export type ReviewMetricEvent = z.infer<typeof reviewMetricEventSchema>;
export interface ReviewTelemetryCursor {
	readonly createdAt: string;
	readonly id: string;
}
export interface ReviewTelemetryPage {
	readonly events: readonly ReviewMetricEvent[];
	readonly nextCursor: ReviewTelemetryCursor | null;
}

export interface ReviewTelemetrySummary {
	readonly period: string;
	readonly phase: ReviewMetricPhase;
	readonly scope: ReviewMetric["scope"];
	readonly sizeBand: ReviewSizeBand;
	readonly sampleCount: number;
	readonly runCount: number;
	readonly p50DurationMs: number;
	readonly p95DurationMs: number;
	readonly failureCount: number;
	readonly cancelledCount: number;
	readonly ignoredCount: number;
	readonly requestCount: number;
	readonly cacheHitCount: number;
	readonly retryCount: number;
	readonly capacityFailureCount: number;
	readonly peakRssBytes: number;
	readonly knownUsageCount: number;
	readonly usage: ReviewMetric["usage"];
}
