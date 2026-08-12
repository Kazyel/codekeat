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
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("findings_review_run_id_index").on(table.reviewRunId),
    uniqueIndex("findings_review_run_path_line_title_unique").on(
      table.reviewRunId,
      table.path,
      table.line,
      table.title,
    ),
  ],
);
