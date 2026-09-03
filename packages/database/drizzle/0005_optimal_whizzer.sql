ALTER TABLE `review_runs` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `cache_tokens` integer;--> statement-breakpoint
ALTER TABLE `review_runs` ADD `cost_usd_micros` integer;