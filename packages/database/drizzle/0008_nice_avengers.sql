ALTER TABLE `findings` ADD `judge_verdict` text DEFAULT 'not_evaluated' NOT NULL;--> statement-breakpoint
ALTER TABLE `findings` ADD `judge_severity` text;--> statement-breakpoint
ALTER TABLE `findings` ADD `judge_rationale` text;--> statement-breakpoint
ALTER TABLE `findings` ADD `included_in_report` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `findings_review_run_included_index` ON `findings` (`review_run_id`,`included_in_report`);--> statement-breakpoint
ALTER TABLE `review_runs` ADD `review_strategy_version` text;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `changed_line_count` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `review_chunk_count` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `judge_call_count` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `processing_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `judge_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `judge_output_tokens` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `judge_cache_tokens` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `judge_cost_usd_micros` integer;