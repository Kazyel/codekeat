import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { reviewRuns } from "./review-runs.js";

/** Private checkpoints contain source evidence and never appear in dashboard responses. */
export const reviewWorkPlans = sqliteTable("review_work_plans", {
	reviewRunId: text("review_run_id")
		.primaryKey()
		.references(() => reviewRuns.id, { onDelete: "cascade" }),
	fingerprint: text("fingerprint").notNull(),
	createdAt: text("created_at").notNull(),
});
export const reviewWorkUnits = sqliteTable(
	"review_work_units",
	{
		id: text("id").primaryKey(),
		reviewRunId: text("review_run_id")
			.notNull()
			.references(() => reviewRuns.id, { onDelete: "cascade" }),
		stage: text("stage", { enum: ["review", "judge"] }).notNull(),
		parentId: text("parent_id"),
		status: text("status", { enum: ["pending", "running", "completed", "split"] }).notNull(),
		ordinal: integer("ordinal").notNull(),
		payloadJson: text("payload_json").notNull(),
		resultJson: text("result_json"),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => [index("review_work_units_run_stage_index").on(table.reviewRunId, table.stage)],
);
export const reviewUsageEvents = sqliteTable(
	"review_usage_events",
	{
		id: text("id").primaryKey(),
		reviewRunId: text("review_run_id")
			.notNull()
			.references(() => reviewRuns.id, { onDelete: "cascade" }),
		stage: text("stage", { enum: ["review", "judge"] }).notNull(),
		callId: text("call_id").notNull(),
		stepNumber: integer("step_number").notNull(),
		inputTokens: integer("input_tokens").notNull(),
		outputTokens: integer("output_tokens").notNull(),
		cacheTokens: integer("cache_tokens").notNull(),
		costUsdMicros: real("cost_usd_micros").notNull(),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		uniqueIndex("review_usage_events_call_step_unique").on(
			table.reviewRunId,
			table.stage,
			table.callId,
			table.stepNumber,
		),
	],
);
