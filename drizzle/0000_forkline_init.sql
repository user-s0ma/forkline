CREATE TABLE `AuditLog` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`actorId` varchar(191) NOT NULL,
	`actorName` varchar(191) NOT NULL,
	`actorEmail` varchar(191) NOT NULL,
	`action` varchar(64) NOT NULL,
	`targetId` varchar(191),
	`targetLabel` varchar(500) NOT NULL,
	`metadata` text NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `AuditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `Account` (
	`id` varchar(191) NOT NULL,
	`accountId` varchar(191) NOT NULL,
	`providerId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` datetime(3),
	`refreshTokenExpiresAt` datetime(3),
	`scope` text,
	`password` text,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `Account_id` PRIMARY KEY(`id`),
	CONSTRAINT `Account_provider_account_idx` UNIQUE(`providerId`,`accountId`)
);
--> statement-breakpoint
CREATE TABLE `Invitation` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`email` varchar(191) NOT NULL,
	`role` varchar(191),
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`expiresAt` datetime(3) NOT NULL,
	`inviterId` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `Invitation_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `Member` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`userId` varchar(191) NOT NULL,
	`role` varchar(191) NOT NULL DEFAULT 'member',
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `Member_id` PRIMARY KEY(`id`),
	CONSTRAINT `Member_organization_user_idx` UNIQUE(`organizationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `Organization` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`slug` varchar(191) NOT NULL,
	`logo` text,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`metadata` text,
	CONSTRAINT `Organization_id` PRIMARY KEY(`id`),
	CONSTRAINT `Organization_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `Session` (
	`id` varchar(191) NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	`token` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`ipAddress` text,
	`userAgent` text,
	`userId` varchar(191) NOT NULL,
	`activeOrganizationId` varchar(191),
	CONSTRAINT `Session_id` PRIMARY KEY(`id`),
	CONSTRAINT `Session_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `User` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`email` varchar(191) NOT NULL,
	`emailVerified` boolean NOT NULL DEFAULT false,
	`image` text,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `User_id` PRIMARY KEY(`id`),
	CONSTRAINT `User_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `Verification` (
	`id` varchar(191) NOT NULL,
	`identifier` varchar(191) NOT NULL,
	`value` text NOT NULL,
	`expiresAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `Verification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ApiKey` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`createdBy` varchar(191) NOT NULL,
	`name` varchar(80) NOT NULL,
	`prefix` varchar(16) NOT NULL,
	`keyHash` varchar(64) NOT NULL,
	`lastUsedAt` datetime(3),
	`revokedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ApiKey_id` PRIMARY KEY(`id`),
	CONSTRAINT `ApiKey_keyHash_key` UNIQUE(`keyHash`)
);
--> statement-breakpoint
CREATE TABLE `LedgerEntry` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`balance` varchar(16) NOT NULL,
	`amountMicros` bigint NOT NULL,
	`referenceId` varchar(191),
	`description` varchar(255) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `LedgerEntry_id` PRIMARY KEY(`id`),
	CONSTRAINT `LedgerEntry_kind_referenceId_key` UNIQUE(`kind`,`referenceId`)
);
--> statement-breakpoint
CREATE TABLE `UsageRecord` (
	`id` varchar(191) NOT NULL,
	`modelId` varchar(191) NOT NULL,
	`modelSlug` varchar(64) NOT NULL,
	`publisherOrganizationId` varchar(191) NOT NULL,
	`consumerOrganizationId` varchar(191) NOT NULL,
	`apiKeyId` varchar(191),
	`userId` varchar(191),
	`source` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL,
	`inputTokens` int NOT NULL DEFAULT 0,
	`outputTokens` int NOT NULL DEFAULT 0,
	`latencyMs` int NOT NULL DEFAULT 0,
	`totalMicros` bigint NOT NULL,
	`computeMicros` bigint NOT NULL,
	`creatorMicros` bigint NOT NULL,
	`platformFeeMicros` bigint NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `UsageRecord_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `Wallet` (
	`organizationId` varchar(191) NOT NULL,
	`creditMicros` bigint NOT NULL DEFAULT 0,
	`earningsMicros` bigint NOT NULL DEFAULT 0,
	`stripeCustomerId` varchar(191),
	`stripeConnectAccountId` varchar(191),
	`payoutsEnabled` boolean NOT NULL DEFAULT false,
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `Wallet_organizationId` PRIMARY KEY(`organizationId`)
);
--> statement-breakpoint
CREATE TABLE `FineTune` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`modelId` varchar(191) NOT NULL,
	`createdBy` varchar(191) NOT NULL,
	`baseModelId` varchar(191) NOT NULL,
	`trainPreset` varchar(64) NOT NULL,
	`trainMicrosPerHour` bigint NOT NULL,
	`datasetName` varchar(255) NOT NULL,
	`datasetUri` varchar(1000),
	`datasetBytes` int NOT NULL,
	`datasetExamples` int NOT NULL,
	`hyperparameters` text NOT NULL,
	`nebiusJobId` varchar(191),
	`status` varchar(16) NOT NULL,
	`adapterUri` varchar(1000),
	`error` varchar(500),
	`estimatedMicros` bigint NOT NULL DEFAULT 0,
	`heldMicros` bigint NOT NULL DEFAULT 0,
	`costMicros` bigint NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`startedAt` datetime(3),
	`completedAt` datetime(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `FineTune_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `OrganizationSecret` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`name` varchar(128) NOT NULL,
	`type` varchar(16) NOT NULL,
	`value` text NOT NULL,
	`createdBy` varchar(191) NOT NULL,
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `OrganizationSecret_id` PRIMARY KEY(`id`),
	CONSTRAINT `OrganizationSecret_organizationId_name_key` UNIQUE(`organizationId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `AiModel` (
	`id` varchar(191) NOT NULL,
	`organizationId` varchar(191) NOT NULL,
	`createdBy` varchar(191) NOT NULL,
	`slug` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`tagline` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`category` varchar(32) NOT NULL,
	`tags` text NOT NULL,
	`runtime` varchar(16) NOT NULL,
	`config` text NOT NULL,
	`secret` text,
	`visibility` varchar(16) NOT NULL DEFAULT 'private',
	`status` varchar(16) NOT NULL DEFAULT 'draft',
	`baseModelId` varchar(191),
	`adapterUri` varchar(1000),
	`fineTuneId` varchar(191),
	`endpointId` varchar(191),
	`endpointStatus` varchar(16) NOT NULL DEFAULT 'none',
	`endpointUrl` varchar(1000),
	`endpointToken` text,
	`endpointMicrosPerHour` bigint NOT NULL DEFAULT 0,
	`endpointError` varchar(500),
	`endpointLastUsedAt` datetime(3),
	`endpointMeteredAt` datetime(3),
	`endpointHeldMicros` bigint NOT NULL DEFAULT 0,
	`priceInputMicros` bigint NOT NULL DEFAULT 0,
	`priceOutputMicros` bigint NOT NULL DEFAULT 0,
	`pricePerRequestMicros` bigint NOT NULL DEFAULT 0,
	`totalRequests` bigint NOT NULL DEFAULT 0,
	`avgCostMicros` bigint,
	`publishedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `AiModel_id` PRIMARY KEY(`id`),
	CONSTRAINT `AiModel_slug_key` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE INDEX `AuditLog_organization_createdAt_idx` ON `AuditLog` (`organizationId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `Account_userId_idx` ON `Account` (`userId`);--> statement-breakpoint
CREATE INDEX `Invitation_organizationId_idx` ON `Invitation` (`organizationId`);--> statement-breakpoint
CREATE INDEX `Invitation_email_idx` ON `Invitation` (`email`);--> statement-breakpoint
CREATE INDEX `Member_organizationId_idx` ON `Member` (`organizationId`);--> statement-breakpoint
CREATE INDEX `Member_userId_idx` ON `Member` (`userId`);--> statement-breakpoint
CREATE INDEX `Session_userId_idx` ON `Session` (`userId`);--> statement-breakpoint
CREATE INDEX `ApiKey_organization_createdAt_idx` ON `ApiKey` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `LedgerEntry_organization_createdAt_idx` ON `LedgerEntry` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `UsageRecord_consumer_createdAt_idx` ON `UsageRecord` (`consumerOrganizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `UsageRecord_publisher_createdAt_idx` ON `UsageRecord` (`publisherOrganizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `UsageRecord_modelId_createdAt_idx` ON `UsageRecord` (`modelId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `FineTune_model_createdAt_idx` ON `FineTune` (`modelId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `FineTune_organization_createdAt_idx` ON `FineTune` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `FineTune_status_idx` ON `FineTune` (`status`);--> statement-breakpoint
CREATE INDEX `OrganizationSecret_organizationId_updatedAt_idx` ON `OrganizationSecret` (`organizationId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `AiModel_organization_updatedAt_idx` ON `AiModel` (`organizationId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `AiModel_listing_idx` ON `AiModel` (`status`,`visibility`,`publishedAt`);--> statement-breakpoint
CREATE INDEX `AiModel_endpointStatus_idx` ON `AiModel` (`endpointStatus`);