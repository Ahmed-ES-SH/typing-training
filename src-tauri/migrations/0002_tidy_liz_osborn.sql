CREATE TABLE `bigram_statistics` (
	`pair` text PRIMARY KEY NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`incorrect` integer DEFAULT 0 NOT NULL,
	`avg_latency_ms` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bigram_statistics_total` ON `bigram_statistics` (`total`);--> statement-breakpoint
CREATE TABLE `key_statistics_daily` (
	`date` text NOT NULL,
	`key` text NOT NULL,
	`shift_required` integer NOT NULL,
	`presses` integer DEFAULT 0 NOT NULL,
	`correct` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `key`, `shift_required`)
);
--> statement-breakpoint
CREATE INDEX `idx_key_statistics_daily_date` ON `key_statistics_daily` (`date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lesson_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` text,
	`kind` text DEFAULT 'lesson' NOT NULL,
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
	`key_report` text,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_lesson_attempts`("id", "lesson_id", "kind", "attempt_number", "wpm", "accuracy", "error_rate", "error_count", "correct_chars", "incorrect_chars", "backspace_count", "duration_ms", "completed", "started_at", "finished_at", "key_report") SELECT "id", "lesson_id", 'lesson', "attempt_number", "wpm", "accuracy", "error_rate", "error_count", "correct_chars", "incorrect_chars", "backspace_count", "duration_ms", "completed", "started_at", "finished_at", "key_report" FROM `lesson_attempts`;--> statement-breakpoint
DROP TABLE `lesson_attempts`;--> statement-breakpoint
ALTER TABLE `__new_lesson_attempts` RENAME TO `lesson_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_lesson_attempts_lesson_id` ON `lesson_attempts` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `idx_lesson_attempts_finished_at` ON `lesson_attempts` (`finished_at`);