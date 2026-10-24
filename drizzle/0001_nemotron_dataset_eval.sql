CREATE TABLE `EvalItem` (
	`id` varchar(191) NOT NULL,
	`runId` varchar(191) NOT NULL,
	`position` int NOT NULL,
	`prompt` text NOT NULL,
	`reference` text NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`claimedAt` datetime(3),
	`fineTunedFirst` boolean NOT NULL,
	`fineTunedAnswer` text,
	`baseAnswer` text,
	`fineTunedScore` int,
	`baseScore` int,
	`fineTunedReason` varchar(300),
	`baseReason` varchar(300),
	`error` varchar(500),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `EvalItem_id` PRIMARY KEY(`id`),
	CONSTRAINT `EvalItem_run_position_key` UNIQUE(`runId`,`position`)
);
--> statement-breakpoint
CREATE TABLE `EvalRun` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`modelId` varchar(191) NOT NULL,
	`fineTuneId` varchar(191) NOT NULL,
	`createdBy` varchar(191) NOT NULL,
	`status` varchar(16) NOT NULL,
	`baselineModel` varchar(191) NOT NULL,
	`judgeModel` varchar(191) NOT NULL,
	`itemCount` int NOT NULL,
	`summary` text,
	`costMicros` bigint NOT NULL DEFAULT 0,
	`error` varchar(500),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`completedAt` datetime(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `EvalRun_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `FineTune` ADD `datasetSource` varchar(16) DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `FineTune` ADD `datasetSummary` text;--> statement-breakpoint
ALTER TABLE `FineTune` ADD `evalSet` mediumtext;--> statement-breakpoint
ALTER TABLE `FineTune` ADD `evalExamples` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `EvalItem_run_status_idx` ON `EvalItem` (`runId`,`status`);--> statement-breakpoint
CREATE INDEX `EvalRun_model_createdAt_idx` ON `EvalRun` (`modelId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `EvalRun_organization_createdAt_idx` ON `EvalRun` (`organizationId`,`createdAt`);