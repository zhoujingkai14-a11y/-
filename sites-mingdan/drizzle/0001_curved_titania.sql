CREATE TABLE `beta_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`ai_enabled` integer DEFAULT 1 NOT NULL,
	`registration_enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`purpose` text NOT NULL,
	`target_user_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_status_expiry` ON `invites` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer,
	`ai_consent_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`mutation_token` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `user_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `reserved_units` integer DEFAULT 1000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `charged_units` integer DEFAULT 1000000 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `prompt_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `cache_hit_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `completion_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_calls` ADD `cost_kind` text DEFAULT 'conservative' NOT NULL;--> statement-breakpoint
CREATE INDEX `ai_calls_account_started` ON `ai_calls` (`user_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `user_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE `shares` ADD `user_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE INDEX `shares_account_order` ON `shares` (`user_id`,`order_id`,`version_id`);
--> statement-breakpoint
INSERT INTO users (id,email,name,role,status,created_at) VALUES ('owner','owner@mingdan.invalid','明单管理者','owner','active',unixepoch()*1000);
--> statement-breakpoint
INSERT INTO beta_settings (id,ai_enabled,registration_enabled) VALUES (1,1,1);
--> statement-breakpoint
INSERT INTO workspaces (user_id,revision,data,mutation_token) SELECT 'owner',revision,data,mutation_token FROM workspace WHERE id=1;
