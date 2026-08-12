CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`review_run_id` text NOT NULL,
	`severity` text NOT NULL,
	`path` text NOT NULL,
	`line` integer NOT NULL,
	`title` text NOT NULL,
	`rationale` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_run_id`) REFERENCES `review_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `findings_review_run_id_index` ON `findings` (`review_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `findings_review_run_path_line_title_unique` ON `findings` (`review_run_id`,`path`,`line`,`title`);--> statement-breakpoint
ALTER TABLE `review_runs` ADD `model_name` text;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `completed_at` text;