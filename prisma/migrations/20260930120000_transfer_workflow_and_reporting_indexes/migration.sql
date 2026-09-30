-- 1. Transfers become a two-step workflow: PENDING → COMPLETED | CANCELLED.
--    Stock moves only on completion, so the business date column is now `completed_at`
--    (existing rows were all completed immediately; their transferred_at carries over).
-- 2. Covering indexes for dashboard aggregation over the ledger.
--
-- Ordering: MySQL requires every foreign key to keep a usable index, so replacement
-- indexes are created before the ones they supersede are dropped. The transfer
-- trigger and CHECK reference renamed columns, so they are dropped first and
-- recreated at the end.

-- ─────────────────────────────────────────────────────────────────────────────
-- Transfers
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS `trg_transfers_immutable`;
ALTER TABLE `transfers` DROP CHECK `chk_transfers_cancel_fields`;

ALTER TABLE `transfers`
  ADD INDEX `transfers_from_base_id_created_at_idx`(`from_base_id`, `created_at`),
  ADD INDEX `transfers_to_base_id_created_at_idx`(`to_base_id`, `created_at`),
  ADD INDEX `transfers_equipment_id_created_at_idx`(`equipment_id`, `created_at`),
  ADD INDEX `transfers_status_created_at_idx`(`status`, `created_at`),
  ADD INDEX `transfers_created_at_idx`(`created_at`);

ALTER TABLE `transfers`
  DROP INDEX `transfers_from_base_id_transferred_at_idx`,
  DROP INDEX `transfers_to_base_id_transferred_at_idx`,
  DROP INDEX `transfers_equipment_id_transferred_at_idx`,
  DROP INDEX `transfers_transferred_at_idx`,
  DROP INDEX `transfers_status_idx`;

ALTER TABLE `transfers`
  CHANGE COLUMN `transferred_at` `completed_at` DATETIME(3) NULL,
  MODIFY `status` ENUM('PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `completed_by_id` INTEGER NULL AFTER `completed_at`;

-- Backfill: every existing COMPLETED transfer was completed by its creator.
UPDATE `transfers` SET `completed_by_id` = `created_by_id` WHERE `status` = 'COMPLETED';
UPDATE `transfers` SET `completed_at` = NULL WHERE `status` = 'CANCELLED';

ALTER TABLE `transfers`
  ADD INDEX `transfers_completed_by_id_idx`(`completed_by_id`),
  ADD CONSTRAINT `transfers_completed_by_id_fkey` FOREIGN KEY (`completed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `transfers`
  ADD CONSTRAINT `chk_transfers_status_fields` CHECK (
    (`status` = 'PENDING'
      AND `completed_at` IS NULL AND `completed_by_id` IS NULL
      AND `cancelled_at` IS NULL AND `cancelled_by_id` IS NULL AND `cancel_reason` IS NULL)
    OR (`status` = 'COMPLETED'
      AND `completed_at` IS NOT NULL AND `completed_by_id` IS NOT NULL
      AND `cancelled_at` IS NULL AND `cancelled_by_id` IS NULL AND `cancel_reason` IS NULL)
    OR (`status` = 'CANCELLED'
      AND `completed_at` IS NULL AND `completed_by_id` IS NULL
      AND `cancelled_at` IS NOT NULL AND `cancelled_by_id` IS NOT NULL AND `cancel_reason` IS NOT NULL)
  );

-- Only a PENDING transfer may change, and then only its status fields (and its
-- reference number, set once right after insert). COMPLETED and CANCELLED are terminal,
-- which makes a second completion impossible even for code that bypasses the service.
CREATE TRIGGER `trg_transfers_immutable` BEFORE UPDATE ON `transfers` FOR EACH ROW
BEGIN
  IF OLD.`status` <> 'PENDING'
     OR NOT (OLD.`from_base_id` <=> NEW.`from_base_id` AND OLD.`to_base_id` <=> NEW.`to_base_id`
             AND OLD.`equipment_id` <=> NEW.`equipment_id` AND OLD.`quantity` <=> NEW.`quantity`
             AND OLD.`created_by_id` <=> NEW.`created_by_id` AND OLD.`created_at` <=> NEW.`created_at`)
     OR (OLD.`reference_no` IS NOT NULL AND NOT (OLD.`reference_no` <=> NEW.`reference_no`)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: only a pending transfer can change, and only its status';
  END IF;
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- Serialized units named on a transfer
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE `transfer_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transfer_id` INTEGER NOT NULL,
    `asset_id` INTEGER NOT NULL,

    UNIQUE INDEX `transfer_assets_transfer_id_asset_id_key`(`transfer_id`, `asset_id`),
    INDEX `transfer_assets_asset_id_idx`(`asset_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `transfer_assets` ADD CONSTRAINT `transfer_assets_transfer_id_fkey` FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `transfer_assets` ADD CONSTRAINT `transfer_assets_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Existing serialized transfers: recover their units from the ledger (one TRANSFER_OUT row per unit).
INSERT INTO `transfer_assets` (`transfer_id`, `asset_id`)
SELECT `transfer_id`, `asset_id` FROM `inventory_movements`
WHERE `type` = 'TRANSFER_OUT' AND `asset_id` IS NOT NULL AND `is_reversal` = 0;

CREATE TRIGGER `trg_transfer_assets_no_update` BEFORE UPDATE ON `transfer_assets` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: transfer_assets is append-only';

CREATE TRIGGER `trg_transfer_assets_no_delete` BEFORE DELETE ON `transfer_assets` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: transfer_assets is append-only';

-- ─────────────────────────────────────────────────────────────────────────────
-- Reporting indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Ledger: each index covers one dashboard filter shape (base+equipment, base,
-- equipment, all bases), so SUM(quantity_delta) by type is answered from the index alone.
ALTER TABLE `inventory_movements`
  ADD INDEX `idx_movements_base_equip_time_cov`(`base_id`, `equipment_id`, `occurred_at`, `type`, `quantity_delta`),
  ADD INDEX `idx_movements_base_time_cov`(`base_id`, `occurred_at`, `type`, `equipment_id`, `quantity_delta`),
  ADD INDEX `idx_movements_equip_time_cov`(`equipment_id`, `occurred_at`, `type`, `base_id`, `quantity_delta`),
  ADD INDEX `idx_movements_time_cov`(`occurred_at`, `type`, `base_id`, `equipment_id`, `quantity_delta`);

ALTER TABLE `inventory_movements`
  DROP INDEX `inventory_movements_base_id_equipment_id_occurred_at_idx`,
  DROP INDEX `inventory_movements_equipment_id_occurred_at_idx`,
  DROP INDEX `inventory_movements_occurred_at_type_idx`;

-- Assignments: "assigned in period" filtered by equipment.
ALTER TABLE `assignments` ADD INDEX `assignments_equipment_id_assigned_at_idx`(`equipment_id`, `assigned_at`);
ALTER TABLE `assignments` DROP INDEX `assignments_equipment_id_idx`;
