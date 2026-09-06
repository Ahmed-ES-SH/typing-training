ALTER TABLE `custom_lessons` ADD `is_draft` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_lessons` ADD `source` text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_lessons` ADD `collection_id` text;--> statement-breakpoint
ALTER TABLE `custom_lessons` ADD `syntax_family` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `custom_lessons` ADD `tags` text DEFAULT '[]' NOT NULL;