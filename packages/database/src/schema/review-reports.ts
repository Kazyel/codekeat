import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { repositories } from "./repositories.js";
import { reviewRuns } from "./review-runs.js";

export const reviewReports = sqliteTable(
  "review_reports",
  {
    id: text("id").primaryKey(),
    githubRepositoryId: integer("github_repository_id")
      .notNull()
      .references(() => repositories.githubRepositoryId),
    pullRequestNumber: integer("pull_request_number").notNull(),
    reviewRunId: text("review_run_id")
      .notNull()
      .references(() => reviewRuns.id),
    githubCommentId: integer("github_comment_id"),
    githubCommentUrl: text("github_comment_url"),
    status: text("status", {
      enum: ["pending", "publishing", "published", "failed"],
    }).notNull(),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    uniqueIndex("review_reports_repository_pr_unique").on(
      table.githubRepositoryId,
      table.pullRequestNumber,
    ),
    uniqueIndex("review_reports_github_comment_id_unique").on(table.githubCommentId),
    index("review_reports_review_run_id_index").on(table.reviewRunId),
  ],
);
