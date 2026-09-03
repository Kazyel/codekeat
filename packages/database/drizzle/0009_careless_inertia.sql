DROP INDEX `review_reports_repository_pr_unique`;--> statement-breakpoint
DROP INDEX `review_reports_review_run_id_index`;--> statement-breakpoint
CREATE UNIQUE INDEX `review_reports_review_run_id_unique` ON `review_reports` (`review_run_id`);