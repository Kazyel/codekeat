CREATE TABLE `installations` (
	`github_installation_id` integer PRIMARY KEY NOT NULL,
	`organization_login` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`github_repository_id` integer PRIMARY KEY NOT NULL,
	`installation_id` integer NOT NULL,
	`owner_login` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`installation_id`) REFERENCES `installations`(`github_installation_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `repositories_installation_id_index` ON `repositories` (`installation_id`);--> statement-breakpoint
CREATE TABLE `review_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`github_repository_id` integer NOT NULL,
	`pull_request_number` integer NOT NULL,
	`head_sha` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`policy_json` text NOT NULL,
	`policy_source` text NOT NULL,
	`policy_warning_code` text,
	`ignore_reason` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`github_repository_id`) REFERENCES `repositories`(`github_repository_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_runs_repository_id_index` ON `review_runs` (`github_repository_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_runs_repository_pr_sha_unique` ON `review_runs` (`github_repository_id`,`pull_request_number`,`head_sha`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`delivery_id` text PRIMARY KEY NOT NULL,
	`event_name` text NOT NULL,
	`installation_id` integer,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`reason_code` text,
	`failure_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_installation_id_index` ON `webhook_deliveries` (`installation_id`);