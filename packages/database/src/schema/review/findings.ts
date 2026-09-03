import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { reviewRuns } from "./review-runs.js";

export const findings = sqliteTable(
	"findings",
	{
		id: text("id").primaryKey(),
		reviewRunId: text("review_run_id")
			.notNull()
			.references(() => reviewRuns.id),
		severity: text("severity", { enum: ["critical", "high", "medium", "low"] }).notNull(),
		path: text("path").notNull(),
		line: integer("line").notNull(),
		title: text("title").notNull(),
		rationale: text("rationale").notNull(),
		judgeVerdict: text("judge_verdict", {
			enum: ["not_evaluated", "approved", "rejected", "severity_changed"],
		})
			.notNull()
			.default("not_evaluated"),
		judgeSeverity: text("judge_severity", {
			enum: ["critical", "high", "medium", "low"],
		}),
		judgeRationale: text("judge_rationale"),
		includedInReport: integer("included_in_report", { mode: "boolean" })
			.notNull()
			.default(true),
		createdAt: text("created_at").notNull(),
	},
	(table) => [
		index("findings_review_run_id_index").on(table.reviewRunId),
		index("findings_review_run_included_index").on(table.reviewRunId, table.includedInReport),
		uniqueIndex("findings_review_run_path_line_title_unique").on(
			table.reviewRunId,
			table.path,
			table.line,
			table.title,
		),
	],
);
