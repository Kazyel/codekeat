import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { repositories } from "../github/repositories.js";
import { models } from "../model/models.js";

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
		modelId: text("model_id").references(() => models.id),
		modelName: text("model_name"),
		modelInputNanoUsdPerToken: integer("model_input_nano_usd_per_token"),
		modelCachedInputNanoUsdPerToken: integer("model_cached_input_nano_usd_per_token"),
		modelOutputNanoUsdPerToken: integer("model_output_nano_usd_per_token"),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		cacheTokens: integer("cache_tokens"),
		costUsdMicros: integer("cost_usd_micros"),
		reviewStrategyVersion: text("review_strategy_version"),
		changedLineCount: integer("changed_line_count"),
		reviewChunkCount: integer("review_chunk_count"),
		judgeCallCount: integer("judge_call_count"),
		processingDurationMs: integer("processing_duration_ms"),
		judgeInputTokens: integer("judge_input_tokens"),
		judgeOutputTokens: integer("judge_output_tokens"),
		judgeCacheTokens: integer("judge_cache_tokens"),
		judgeCostUsdMicros: integer("judge_cost_usd_micros"),
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
