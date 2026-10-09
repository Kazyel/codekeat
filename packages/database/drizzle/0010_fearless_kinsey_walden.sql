CREATE TABLE `review_telemetry` (
	`id` text PRIMARY KEY NOT NULL,
	`review_run_id` text NOT NULL,
	`phase` text NOT NULL,
	`scope` text NOT NULL,
	`attempt_id` text,
	`call_id` text,
	`unit_id` text,
	`duration_ms` integer NOT NULL,
	`outcome` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_tokens` integer,
	`cost_usd_micros` real,
	`counted_input_tokens` integer,
	`diff_bytes` integer,
	`source_bytes` integer,
	`source_count` integer,
	`request_count` integer NOT NULL,
	`cache_hit_count` integer NOT NULL,
	`retry_count` integer NOT NULL,
	`peak_rss_bytes` integer NOT NULL,
	`capacity_failure` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_run_id`) REFERENCES `review_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_telemetry_run_id_index` ON `review_telemetry` (`review_run_id`);--> statement-breakpoint
CREATE INDEX `review_telemetry_created_at_index` ON `review_telemetry` (`created_at`);--> statement-breakpoint
CREATE TABLE `review_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`review_run_id` text NOT NULL,
	`stage` text NOT NULL,
	`call_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cache_tokens` integer NOT NULL,
	`cost_usd_micros` real NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_run_id`) REFERENCES `review_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_usage_events_call_step_unique` ON `review_usage_events` (`review_run_id`,`stage`,`call_id`,`step_number`);--> statement-breakpoint
CREATE TABLE `review_work_plans` (
	`review_run_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_run_id`) REFERENCES `review_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_work_units` (
	`id` text PRIMARY KEY NOT NULL,
	`review_run_id` text NOT NULL,
	`stage` text NOT NULL,
	`parent_id` text,
	`status` text NOT NULL,
	`ordinal` integer NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_run_id`) REFERENCES `review_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_work_units_run_stage_index` ON `review_work_units` (`review_run_id`,`stage`);