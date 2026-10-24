ALTER TABLE `FineTune` ADD `activeKey` varchar(191);--> statement-breakpoint
ALTER TABLE `FineTune` ADD CONSTRAINT `FineTune_activeKey_key` UNIQUE(`activeKey`);