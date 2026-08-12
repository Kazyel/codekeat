CREATE TABLE `dashboard_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `dashboard_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_sessions_token_hash_unique` ON `dashboard_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `dashboard_sessions_user_id_index` ON `dashboard_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `dashboard_sessions_expires_at_index` ON `dashboard_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `dashboard_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_users_email_unique` ON `dashboard_users` (`email`);