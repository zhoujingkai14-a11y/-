CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`purpose` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_calls_started` ON `ai_calls` (`started_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`order_id` text NOT NULL,
	`version_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`digest` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`response` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_unique` ON `shares` (`token`);--> statement-breakpoint
CREATE INDEX `shares_order_version` ON `shares` (`order_id`,`version_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`mutation_token` text DEFAULT '' NOT NULL
);
