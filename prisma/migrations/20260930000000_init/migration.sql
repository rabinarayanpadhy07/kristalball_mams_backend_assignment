-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` ENUM('ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `full_name` VARCHAR(150) NOT NULL,
    `service_number` VARCHAR(50) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role_id` INTEGER NOT NULL,
    `base_id` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `token_version` INTEGER NOT NULL DEFAULT 0,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `password_changed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_service_number_key`(`service_number`),
    INDEX `users_role_id_idx`(`role_id`),
    INDEX `users_base_id_idx`(`base_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `replaced_by_token_id` INTEGER NULL,
    `created_by_ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    INDEX `refresh_tokens_family_id_idx`(`family_id`),
    INDEX `refresh_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `method` VARCHAR(10) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `response_status` INTEGER NULL,
    `response_body` JSON NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idempotency_keys_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `idempotency_keys_user_id_key_key`(`user_id`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `location` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bases_code_key`(`code`),
    UNIQUE INDEX `bases_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `equipment_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `equipment_types_code_key`(`code`),
    UNIQUE INDEX `equipment_types_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `equipment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `equipment_type_id` INTEGER NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `tracking_type` ENUM('SERIALIZED', 'QUANTITY') NOT NULL,
    `unit_of_measure` ENUM('UNIT', 'ROUND', 'BOX', 'LITRE', 'KILOGRAM') NOT NULL DEFAULT 'UNIT',
    `description` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `equipment_code_key`(`code`),
    INDEX `equipment_tracking_type_idx`(`tracking_type`),
    UNIQUE INDEX `equipment_equipment_type_id_name_key`(`equipment_type_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `equipment_id` INTEGER NOT NULL,
    `serial_number` VARCHAR(100) NOT NULL,
    `current_base_id` INTEGER NOT NULL,
    `status` ENUM('AVAILABLE', 'ASSIGNED', 'EXPENDED') NOT NULL DEFAULT 'AVAILABLE',
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assets_current_base_id_equipment_id_status_idx`(`current_base_id`, `equipment_id`, `status`),
    UNIQUE INDEX `assets_equipment_id_serial_number_key`(`equipment_id`, `serial_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `base_id` INTEGER NOT NULL,
    `equipment_id` INTEGER NOT NULL,
    `quantity_on_hand` INTEGER NOT NULL DEFAULT 0,
    `quantity_assigned` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `inventory_equipment_id_idx`(`equipment_id`),
    UNIQUE INDEX `inventory_base_id_equipment_id_key`(`base_id`, `equipment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `base_id` INTEGER NOT NULL,
    `equipment_id` INTEGER NOT NULL,
    `asset_id` INTEGER NULL,
    `type` ENUM('PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'EXPENDITURE', 'ADJUSTMENT') NOT NULL,
    `quantity_delta` INTEGER NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `is_reversal` BOOLEAN NOT NULL DEFAULT false,
    `purchase_id` INTEGER NULL,
    `transfer_id` INTEGER NULL,
    `expenditure_id` INTEGER NULL,
    `adjustment_id` INTEGER NULL,
    `created_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `inventory_movements_base_id_equipment_id_occurred_at_idx`(`base_id`, `equipment_id`, `occurred_at`),
    INDEX `inventory_movements_equipment_id_occurred_at_idx`(`equipment_id`, `occurred_at`),
    INDEX `inventory_movements_occurred_at_type_idx`(`occurred_at`, `type`),
    INDEX `inventory_movements_asset_id_occurred_at_idx`(`asset_id`, `occurred_at`),
    INDEX `inventory_movements_purchase_id_idx`(`purchase_id`),
    INDEX `inventory_movements_transfer_id_idx`(`transfer_id`),
    INDEX `inventory_movements_expenditure_id_idx`(`expenditure_id`),
    INDEX `inventory_movements_adjustment_id_idx`(`adjustment_id`),
    INDEX `inventory_movements_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference_no` VARCHAR(30) NULL,
    `base_id` INTEGER NOT NULL,
    `equipment_id` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unit_cost` DECIMAL(14, 2) NULL,
    `supplier_name` VARCHAR(191) NULL,
    `purchase_order_no` VARCHAR(50) NULL,
    `purchased_at` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('POSTED', 'VOIDED') NOT NULL DEFAULT 'POSTED',
    `created_by_id` INTEGER NOT NULL,
    `voided_by_id` INTEGER NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchases_reference_no_key`(`reference_no`),
    INDEX `purchases_base_id_purchased_at_idx`(`base_id`, `purchased_at`),
    INDEX `purchases_equipment_id_purchased_at_idx`(`equipment_id`, `purchased_at`),
    INDEX `purchases_purchased_at_idx`(`purchased_at`),
    INDEX `purchases_status_idx`(`status`),
    INDEX `purchases_created_by_id_idx`(`created_by_id`),
    INDEX `purchases_voided_by_id_idx`(`voided_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transfers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference_no` VARCHAR(30) NULL,
    `from_base_id` INTEGER NOT NULL,
    `to_base_id` INTEGER NOT NULL,
    `equipment_id` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `transferred_at` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'COMPLETED',
    `created_by_id` INTEGER NOT NULL,
    `cancelled_by_id` INTEGER NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `transfers_reference_no_key`(`reference_no`),
    INDEX `transfers_from_base_id_transferred_at_idx`(`from_base_id`, `transferred_at`),
    INDEX `transfers_to_base_id_transferred_at_idx`(`to_base_id`, `transferred_at`),
    INDEX `transfers_equipment_id_transferred_at_idx`(`equipment_id`, `transferred_at`),
    INDEX `transfers_transferred_at_idx`(`transferred_at`),
    INDEX `transfers_status_idx`(`status`),
    INDEX `transfers_created_by_id_idx`(`created_by_id`),
    INDEX `transfers_cancelled_by_id_idx`(`cancelled_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference_no` VARCHAR(30) NULL,
    `base_id` INTEGER NOT NULL,
    `equipment_id` INTEGER NOT NULL,
    `asset_id` INTEGER NULL,
    `quantity` INTEGER NOT NULL,
    `quantity_returned` INTEGER NOT NULL DEFAULT 0,
    `quantity_expended` INTEGER NOT NULL DEFAULT 0,
    `assignee_name` VARCHAR(150) NOT NULL,
    `assignee_service_no` VARCHAR(50) NOT NULL,
    `assignee_unit` VARCHAR(150) NULL,
    `purpose` VARCHAR(255) NULL,
    `assigned_at` DATETIME(3) NOT NULL,
    `expected_return_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'RETURNED', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `created_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `assignments_reference_no_key`(`reference_no`),
    INDEX `assignments_base_id_assigned_at_idx`(`base_id`, `assigned_at`),
    INDEX `assignments_base_id_status_idx`(`base_id`, `status`),
    INDEX `assignments_equipment_id_idx`(`equipment_id`),
    INDEX `assignments_asset_id_idx`(`asset_id`),
    INDEX `assignments_assignee_service_no_idx`(`assignee_service_no`),
    INDEX `assignments_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignment_returns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assignment_id` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `condition` ENUM('SERVICEABLE', 'UNSERVICEABLE') NOT NULL DEFAULT 'SERVICEABLE',
    `returned_at` DATETIME(3) NOT NULL,
    `notes` VARCHAR(500) NULL,
    `received_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assignment_returns_assignment_id_idx`(`assignment_id`),
    INDEX `assignment_returns_received_by_id_idx`(`received_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenditures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference_no` VARCHAR(30) NULL,
    `base_id` INTEGER NOT NULL,
    `equipment_id` INTEGER NOT NULL,
    `asset_id` INTEGER NULL,
    `assignment_id` INTEGER NULL,
    `quantity` INTEGER NOT NULL,
    `reason` ENUM('TRAINING', 'OPERATION', 'MAINTENANCE', 'DAMAGED', 'LOST', 'OTHER') NOT NULL,
    `expended_at` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('POSTED', 'VOIDED') NOT NULL DEFAULT 'POSTED',
    `created_by_id` INTEGER NOT NULL,
    `voided_by_id` INTEGER NULL,
    `voided_at` DATETIME(3) NULL,
    `void_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `expenditures_reference_no_key`(`reference_no`),
    INDEX `expenditures_base_id_expended_at_idx`(`base_id`, `expended_at`),
    INDEX `expenditures_equipment_id_expended_at_idx`(`equipment_id`, `expended_at`),
    INDEX `expenditures_expended_at_idx`(`expended_at`),
    INDEX `expenditures_asset_id_idx`(`asset_id`),
    INDEX `expenditures_assignment_id_idx`(`assignment_id`),
    INDEX `expenditures_status_idx`(`status`),
    INDEX `expenditures_created_by_id_idx`(`created_by_id`),
    INDEX `expenditures_voided_by_id_idx`(`voided_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_adjustments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reference_no` VARCHAR(30) NULL,
    `base_id` INTEGER NOT NULL,
    `equipment_id` INTEGER NOT NULL,
    `quantity_delta` INTEGER NOT NULL,
    `reason` ENUM('OPENING_STOCK', 'STOCKTAKE_CORRECTION', 'OTHER') NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `notes` TEXT NULL,
    `created_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `stock_adjustments_reference_no_key`(`reference_no`),
    INDEX `stock_adjustments_base_id_occurred_at_idx`(`base_id`, `occurred_at`),
    INDEX `stock_adjustments_equipment_id_occurred_at_idx`(`equipment_id`, `occurred_at`),
    INDEX `stock_adjustments_created_by_id_idx`(`created_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actor_user_id` INTEGER NULL,
    `actor_email` VARCHAR(191) NULL,
    `actor_role` ENUM('ADMIN', 'BASE_COMMANDER', 'LOGISTICS_OFFICER') NULL,
    `action` VARCHAR(64) NOT NULL,
    `entity_type` VARCHAR(64) NOT NULL,
    `entity_id` VARCHAR(64) NULL,
    `base_id` INTEGER NULL,
    `request_id` VARCHAR(64) NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_created_at_idx`(`created_at`),
    INDEX `audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `audit_logs_base_id_created_at_idx`(`base_id`, `created_at`),
    INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
    INDEX `audit_logs_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_base_id_fkey` FOREIGN KEY (`base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `equipment` ADD CONSTRAINT `equipment_equipment_type_id_fkey` FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_types`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_equipment_id_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_current_base_id_fkey` FOREIGN KEY (`current_base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory` ADD CONSTRAINT `inventory_base_id_fkey` FOREIGN KEY (`base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory` ADD CONSTRAINT `inventory_equipment_id_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_base_id_fkey` FOREIGN KEY (`base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_equipment_id_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_transfer_id_fkey` FOREIGN KEY (`transfer_id`) REFERENCES `transfers`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_expenditure_id_fkey` FOREIGN KEY (`expenditure_id`) REFERENCES `expenditures`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_adjustment_id_fkey` FOREIGN KEY (`adjustment_id`) REFERENCES `stock_adjustments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_movements` ADD CONSTRAINT `inventory_movements_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_base_id_fkey` FOREIGN KEY (`base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_equipment_id_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_voided_by_id_fkey` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_from_base_id_fkey` FOREIGN KEY (`from_base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_to_base_id_fkey` FOREIGN KEY (`to_base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_equipment_id_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `transfers` ADD CONSTRAINT `transfers_cancelled_by_id_fkey` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_base_id_fkey` FOREIGN KEY (`base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_equipment_id_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assignment_returns` ADD CONSTRAINT `assignment_returns_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `assignment_returns` ADD CONSTRAINT `assignment_returns_received_by_id_fkey` FOREIGN KEY (`received_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `expenditures` ADD CONSTRAINT `expenditures_base_id_fkey` FOREIGN KEY (`base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `expenditures` ADD CONSTRAINT `expenditures_equipment_id_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `expenditures` ADD CONSTRAINT `expenditures_asset_id_fkey` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `expenditures` ADD CONSTRAINT `expenditures_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `expenditures` ADD CONSTRAINT `expenditures_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `expenditures` ADD CONSTRAINT `expenditures_voided_by_id_fkey` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_base_id_fkey` FOREIGN KEY (`base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_equipment_id_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_adjustments` ADD CONSTRAINT `stock_adjustments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_base_id_fkey` FOREIGN KEY (`base_id`) REFERENCES `bases`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
