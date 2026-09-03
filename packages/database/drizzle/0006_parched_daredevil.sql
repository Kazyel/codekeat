CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`api_name` text NOT NULL,
	`input_nano_usd_per_token` integer NOT NULL,
	`cached_input_nano_usd_per_token` integer NOT NULL,
	`output_nano_usd_per_token` integer NOT NULL,
	`enabled` integer NOT NULL,
	`selected` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `models_api_name_unique` ON `models` (`api_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `models_selected_unique` ON `models` (`selected`) WHERE "models"."selected" = 1;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `model_id` text REFERENCES models(id);--> statement-breakpoint
ALTER TABLE `review_runs` ADD `model_input_nano_usd_per_token` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `model_cached_input_nano_usd_per_token` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `model_output_nano_usd_per_token` integer;