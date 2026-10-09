import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { reviewRuns } from "./review-runs.js";

/** Numeric operational metadata only. Source content and credentials never enter this table. */
export const reviewTelemetry = sqliteTable(
	"review_telemetry",
	{
		id: text("id").primaryKey(),
		reviewRunId: text("review_run_id")
			.notNull()
			.references(() => reviewRuns.id, { onDelete: "cascade" }),
		phase: text("phase", {
			enum: ["queue", "input", "prepare", "count", "generation", "tool", "judge"],
		}).notNull(),
		scope: text("scope", { enum: ["phase", "operation"] }).notNull(),
		attemptId: text("attempt_id"),
		callId: text("call_id"),
		unitId: text("unit_id"),
		durationMs: integer("duration_ms").notNull(),
		outcome: text("outcome", {
			enum: ["success", "failed", "ignored", "cancelled"],
		}).notNull(),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		reasoningTokens: integer("reasoning_tokens"),
		cacheTokens: integer("cache_tokens"),
		costUsdMicros: real("cost_usd_micros"),
		countedInputTokens: integer("counted_input_tokens"),
		diffBytes: integer("diff_bytes"),
		sourceBytes: integer("source_bytes"),
		sourceCount: integer("source_count"),
		requestCount: integer("request_count").notNull(),
		cacheHitCount: integer("cache_hit_count").notNull(),
		retryCount: integer("retry_count").notNull(),
		peakRssBytes: integer("peak_rss_bytes").notNull(),
		capacityFailure: integer("capacity_failure", { mode: "boolean" }).notNull(),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		index("review_telemetry_run_id_index").on(table.reviewRunId),
		index("review_telemetry_created_at_index").on(table.createdAt),
	],
);
