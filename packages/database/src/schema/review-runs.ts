import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { repositories } from "./repositories.js";

export const reviewRuns = sqliteTable(
  "review_runs",
  {
    id: text("id").primaryKey(),
    githubRepositoryId: integer("github_repository_id")
      .notNull()
      .references(() => repositories.githubRepositoryId),
    pullRequestNumber: integer("pull_request_number").notNull(),
    headSha: text("head_sha").notNull(),
    trigger: text("trigger", {
      enum: ["opened", "reopened", "ready_for_review", "synchronize"],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "ignored"],
    }).notNull(),
    policyJson: text("policy_json").notNull(),
    policySource: text("policy_source", { enum: ["default", "repository"] }).notNull(),
    policyWarningCode: text("policy_warning_code"),
    ignoreReason: text("ignore_reason"),
    errorCode: text("error_code"),
    modelName: text("model_name"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("review_runs_repository_id_index").on(table.githubRepositoryId),
    uniqueIndex("review_runs_repository_pr_sha_unique").on(
      table.githubRepositoryId,
      table.pullRequestNumber,
      table.headSha,
    ),
  ],
);
