CREATE TABLE `custom_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`difficulty` text DEFAULT 'medium' NOT NULL,
	`target_keys` text DEFAULT '[]' NOT NULL,
	`target_symbols` text DEFAULT '[]' NOT NULL,
	`wpm_target` real,
	`accuracy_target` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_goals` (
	`date` text PRIMARY KEY NOT NULL,
	`minutes_goal` integer NOT NULL,
	`lessons_goal` integer NOT NULL,
	`chars_goal` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `key_statistics` (
	`key` text NOT NULL,
	`shift_required` integer NOT NULL,
	`total_presses` integer DEFAULT 0 NOT NULL,
	`correct_presses` integer DEFAULT 0 NOT NULL,
	`incorrect_presses` integer DEFAULT 0 NOT NULL,
	`avg_latency_ms` real DEFAULT 0 NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`key`, `shift_required`)
);
--> statement-breakpoint
CREATE TABLE `lesson_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`wpm` real NOT NULL,
	`accuracy` real NOT NULL,
	`error_rate` real NOT NULL,
	`error_count` integer NOT NULL,
	`correct_chars` integer NOT NULL,
	`incorrect_chars` integer NOT NULL,
	`backspace_count` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`completed` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lesson_attempts_lesson_id` ON `lesson_attempts` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `idx_lesson_attempts_finished_at` ON `lesson_attempts` (`finished_at`);--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`lesson_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'locked' NOT NULL,
	`best_wpm` real DEFAULT 0 NOT NULL,
	`best_accuracy` real DEFAULT 0 NOT NULL,
	`lowest_error_rate` real DEFAULT 100 NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`unlocked_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lesson_progress_status` ON `lesson_progress` (`status`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`order_index` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`target_keys` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'builtin' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'lesson' NOT NULL,
	`lesson_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_ms` integer,
	`chars_typed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
