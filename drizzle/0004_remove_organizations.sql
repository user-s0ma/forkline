-- 組織をなくし、モデル・学習・残高・キーを利用者に直接結びつける。
-- 組織の ID は、その組織のオーナーの利用者 ID に置き換える。先に scripts/check-organizations.ts で置き換えられることを確かめる。
-- 残高を最初に置き換える (1人が2つの組織のオーナーだと主キーが重なってここで止まり、ほかの表はまだ変わらない)
UPDATE `Wallet` t JOIN `Member` m ON m.`organizationId` = t.`organizationId` AND FIND_IN_SET('owner', m.`role`) SET t.`organizationId` = m.`userId`;--> statement-breakpoint
UPDATE `LedgerEntry` t JOIN `Member` m ON m.`organizationId` = t.`organizationId` AND FIND_IN_SET('owner', m.`role`) SET t.`organizationId` = m.`userId`;--> statement-breakpoint
UPDATE `ApiKey` t JOIN `Member` m ON m.`organizationId` = t.`organizationId` AND FIND_IN_SET('owner', m.`role`) SET t.`organizationId` = m.`userId`;--> statement-breakpoint
UPDATE `AiModel` t JOIN `Member` m ON m.`organizationId` = t.`organizationId` AND FIND_IN_SET('owner', m.`role`) SET t.`organizationId` = m.`userId`;--> statement-breakpoint
UPDATE `FineTune` t JOIN `Member` m ON m.`organizationId` = t.`organizationId` AND FIND_IN_SET('owner', m.`role`) SET t.`organizationId` = m.`userId`;--> statement-breakpoint
UPDATE `EvalRun` t JOIN `Member` m ON m.`organizationId` = t.`organizationId` AND FIND_IN_SET('owner', m.`role`) SET t.`organizationId` = m.`userId`;--> statement-breakpoint
UPDATE `UsageRecord` t JOIN `Member` m ON m.`organizationId` = t.`publisherOrganizationId` AND FIND_IN_SET('owner', m.`role`) SET t.`publisherOrganizationId` = m.`userId`;--> statement-breakpoint
UPDATE `UsageRecord` t JOIN `Member` m ON m.`organizationId` = t.`consumerOrganizationId` AND FIND_IN_SET('owner', m.`role`) SET t.`consumerOrganizationId` = m.`userId`;--> statement-breakpoint
ALTER TABLE `Wallet` RENAME COLUMN `organizationId` TO `userId`;--> statement-breakpoint
ALTER TABLE `LedgerEntry` RENAME COLUMN `organizationId` TO `userId`;--> statement-breakpoint
ALTER TABLE `LedgerEntry` RENAME INDEX `LedgerEntry_organization_createdAt_idx` TO `LedgerEntry_user_createdAt_idx`;--> statement-breakpoint
ALTER TABLE `ApiKey` RENAME COLUMN `organizationId` TO `userId`;--> statement-breakpoint
ALTER TABLE `ApiKey` RENAME INDEX `ApiKey_organization_createdAt_idx` TO `ApiKey_user_createdAt_idx`;--> statement-breakpoint
ALTER TABLE `ApiKey` DROP COLUMN `createdBy`;--> statement-breakpoint
ALTER TABLE `AiModel` RENAME COLUMN `organizationId` TO `userId`;--> statement-breakpoint
ALTER TABLE `AiModel` RENAME INDEX `AiModel_organization_updatedAt_idx` TO `AiModel_user_updatedAt_idx`;--> statement-breakpoint
ALTER TABLE `AiModel` DROP COLUMN `createdBy`;--> statement-breakpoint
ALTER TABLE `FineTune` RENAME COLUMN `organizationId` TO `userId`;--> statement-breakpoint
ALTER TABLE `FineTune` RENAME INDEX `FineTune_organization_createdAt_idx` TO `FineTune_user_createdAt_idx`;--> statement-breakpoint
ALTER TABLE `FineTune` DROP COLUMN `createdBy`;--> statement-breakpoint
ALTER TABLE `EvalRun` RENAME COLUMN `organizationId` TO `userId`;--> statement-breakpoint
ALTER TABLE `EvalRun` RENAME INDEX `EvalRun_organization_createdAt_idx` TO `EvalRun_user_createdAt_idx`;--> statement-breakpoint
ALTER TABLE `EvalRun` DROP COLUMN `createdBy`;--> statement-breakpoint
ALTER TABLE `UsageRecord` RENAME COLUMN `publisherOrganizationId` TO `publisherUserId`;--> statement-breakpoint
ALTER TABLE `UsageRecord` RENAME COLUMN `consumerOrganizationId` TO `consumerUserId`;--> statement-breakpoint
ALTER TABLE `UsageRecord` DROP COLUMN `userId`;--> statement-breakpoint
ALTER TABLE `Session` DROP COLUMN `activeOrganizationId`;--> statement-breakpoint
DROP TABLE `Invitation`;--> statement-breakpoint
DROP TABLE `Member`;--> statement-breakpoint
DROP TABLE `Organization`;--> statement-breakpoint
DROP TABLE `AuditLog`;
