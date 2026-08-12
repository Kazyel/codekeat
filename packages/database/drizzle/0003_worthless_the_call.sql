CREATE TABLE `review_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`github_repository_id` integer NOT NULL,
	`pull_request_number` integer NOT NULL,
	`review_run_id` text NOT NULL,
	`github_comment_id` integer,
	`github_comment_url` text,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`github_repository_id`) REFERENCES `repositories`(`github_repository_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_run_id`) REFERENCES `review_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_reports_repository_pr_unique` ON `review_reports` (`github_repository_id`,`pull_request_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_reports_github_comment_id_unique` ON `review_reports` (`github_comment_id`);--> statement-breakpoint
CREATE INDEX `review_reports_review_run_id_index` ON `review_reports` (`review_run_id`);