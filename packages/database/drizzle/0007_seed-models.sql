INSERT INTO `models` (
	`id`,
	`display_name`,
	`api_name`,
	`input_nano_usd_per_token`,
	`cached_input_nano_usd_per_token`,
	`output_nano_usd_per_token`,
	`enabled`,
	`selected`,
	`created_at`,
	`updated_at`
) VALUES
	('01991700-0000-7000-8000-000000000038', 'Gemini 3.8 Flash', 'gemini-3.8-flash', 750, 75, 3750, 1, 1, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'),
	('01991700-0000-7000-8000-000000000037', 'Gemini 3.7 Flash', 'gemini-3.7-flash', 750, 75, 3750, 1, 0, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'),
	('01991700-0000-7000-8000-000000000036', 'Gemini 3.6 Flash', 'gemini-3.6-flash', 750, 75, 3750, 1, 0, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'),
	('01991700-0000-7000-8000-000000000035', 'Gemini 3.5 Flash', 'gemini-3.5-flash', 1500, 150, 9000, 1, 0, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'),
	('01991700-0000-7000-8000-000000000350', 'Gemini 3.5 Flash-Lite', 'gemini-3.5-flash-lite', 300, 30, 2500, 1, 0, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z'),
	('01991700-0000-7000-8000-000000000310', 'Gemini 3.1 Flash-Lite', 'gemini-3.1-flash-lite', 250, 25, 1500, 1, 0, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
--> statement-breakpoint
UPDATE `review_runs`
SET `model_name` = 'gemini-3.8-flash'
WHERE `model_name` IS NULL AND `status` != 'completed';
--> statement-breakpoint
UPDATE `review_runs`
SET
	`model_id` = (SELECT `id` FROM `models` WHERE `api_name` = `review_runs`.`model_name`),
	`model_input_nano_usd_per_token` = (SELECT `input_nano_usd_per_token` FROM `models` WHERE `api_name` = `review_runs`.`model_name`),
	`model_cached_input_nano_usd_per_token` = (SELECT `cached_input_nano_usd_per_token` FROM `models` WHERE `api_name` = `review_runs`.`model_name`),
	`model_output_nano_usd_per_token` = (SELECT `output_nano_usd_per_token` FROM `models` WHERE `api_name` = `review_runs`.`model_name`)
WHERE EXISTS (SELECT 1 FROM `models` WHERE `api_name` = `review_runs`.`model_name`);