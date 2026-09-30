-- Integrity rules Prisma schema language cannot express: CHECK constraints and
-- immutability triggers. Prisma does not introspect either, so later `migrate dev`
-- runs will not try to drop them. Any new column that participates in these rules
-- must be added here by hand.
--
-- Error convention: every trigger raises SQLSTATE 45000 with a message prefixed
-- "MAMS_INTEGRITY:" so the API can map it to a 409 instead of a 500.

-- ─────────────────────────────────────────────────────────────────────────────
-- CHECK constraints
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `users`
  ADD CONSTRAINT `chk_users_counters_nonneg`
    CHECK (`token_version` >= 0 AND `failed_login_count` >= 0);

ALTER TABLE `inventory`
  ADD CONSTRAINT `chk_inventory_on_hand_nonneg`   CHECK (`quantity_on_hand` >= 0),
  ADD CONSTRAINT `chk_inventory_assigned_nonneg`  CHECK (`quantity_assigned` >= 0),
  ADD CONSTRAINT `chk_inventory_assigned_le_on_hand` CHECK (`quantity_assigned` <= `quantity_on_hand`);

ALTER TABLE `inventory_movements`
  ADD CONSTRAINT `chk_movement_delta_nonzero` CHECK (`quantity_delta` <> 0),
  -- exactly one source document per ledger row
  ADD CONSTRAINT `chk_movement_single_source` CHECK (
    (`purchase_id` IS NOT NULL) + (`transfer_id` IS NOT NULL)
    + (`expenditure_id` IS NOT NULL) + (`adjustment_id` IS NOT NULL) = 1
  ),
  -- the source document must match the movement type
  ADD CONSTRAINT `chk_movement_source_matches_type` CHECK (
    ((`type` = 'PURCHASE') = (`purchase_id` IS NOT NULL))
    AND ((`type` IN ('TRANSFER_IN', 'TRANSFER_OUT')) = (`transfer_id` IS NOT NULL))
    AND ((`type` = 'EXPENDITURE') = (`expenditure_id` IS NOT NULL))
    AND ((`type` = 'ADJUSTMENT') = (`adjustment_id` IS NOT NULL))
  ),
  -- inbound types add stock, outbound types remove it; reversals flip the sign
  ADD CONSTRAINT `chk_movement_sign_matches_type` CHECK (
    (`type` IN ('PURCHASE', 'TRANSFER_IN')
      AND ((`quantity_delta` > 0 AND `is_reversal` = 0) OR (`quantity_delta` < 0 AND `is_reversal` = 1)))
    OR (`type` IN ('TRANSFER_OUT', 'EXPENDITURE')
      AND ((`quantity_delta` < 0 AND `is_reversal` = 0) OR (`quantity_delta` > 0 AND `is_reversal` = 1)))
    OR (`type` = 'ADJUSTMENT' AND `is_reversal` = 0)
  ),
  -- serialized rows move exactly one unit
  ADD CONSTRAINT `chk_movement_asset_single_unit` CHECK (`asset_id` IS NULL OR `quantity_delta` IN (-1, 1));

ALTER TABLE `purchases`
  ADD CONSTRAINT `chk_purchases_quantity_pos` CHECK (`quantity` > 0),
  ADD CONSTRAINT `chk_purchases_unit_cost_nonneg` CHECK (`unit_cost` IS NULL OR `unit_cost` >= 0),
  ADD CONSTRAINT `chk_purchases_void_fields` CHECK (
    (`status` = 'POSTED' AND `voided_at` IS NULL AND `voided_by_id` IS NULL AND `void_reason` IS NULL)
    OR (`status` = 'VOIDED' AND `voided_at` IS NOT NULL AND `voided_by_id` IS NOT NULL AND `void_reason` IS NOT NULL)
  );

ALTER TABLE `transfers`
  ADD CONSTRAINT `chk_transfers_quantity_pos` CHECK (`quantity` > 0),
  ADD CONSTRAINT `chk_transfers_distinct_bases` CHECK (`from_base_id` <> `to_base_id`),
  ADD CONSTRAINT `chk_transfers_cancel_fields` CHECK (
    (`status` = 'COMPLETED' AND `cancelled_at` IS NULL AND `cancelled_by_id` IS NULL AND `cancel_reason` IS NULL)
    OR (`status` = 'CANCELLED' AND `cancelled_at` IS NOT NULL AND `cancelled_by_id` IS NOT NULL AND `cancel_reason` IS NOT NULL)
  );

ALTER TABLE `assignments`
  ADD CONSTRAINT `chk_assignments_quantity_pos` CHECK (`quantity` > 0),
  ADD CONSTRAINT `chk_assignments_settled_nonneg` CHECK (`quantity_returned` >= 0 AND `quantity_expended` >= 0),
  ADD CONSTRAINT `chk_assignments_settled_le_quantity` CHECK (`quantity_returned` + `quantity_expended` <= `quantity`),
  ADD CONSTRAINT `chk_assignments_asset_single_unit` CHECK (`asset_id` IS NULL OR `quantity` = 1),
  ADD CONSTRAINT `chk_assignments_expected_return` CHECK (`expected_return_at` IS NULL OR `expected_return_at` >= `assigned_at`),
  ADD CONSTRAINT `chk_assignments_status` CHECK (
    (`status` = 'ACTIVE' AND `quantity_returned` + `quantity_expended` < `quantity` AND `closed_at` IS NULL)
    OR (`status` = 'RETURNED' AND `quantity_returned` = `quantity` AND `closed_at` IS NOT NULL)
    OR (`status` = 'CLOSED' AND `quantity_expended` > 0
        AND `quantity_returned` + `quantity_expended` = `quantity` AND `closed_at` IS NOT NULL)
  );

ALTER TABLE `assignment_returns`
  ADD CONSTRAINT `chk_assignment_returns_quantity_pos` CHECK (`quantity` > 0);

ALTER TABLE `expenditures`
  ADD CONSTRAINT `chk_expenditures_quantity_pos` CHECK (`quantity` > 0),
  ADD CONSTRAINT `chk_expenditures_asset_single_unit` CHECK (`asset_id` IS NULL OR `quantity` = 1),
  ADD CONSTRAINT `chk_expenditures_void_fields` CHECK (
    (`status` = 'POSTED' AND `voided_at` IS NULL AND `voided_by_id` IS NULL AND `void_reason` IS NULL)
    OR (`status` = 'VOIDED' AND `voided_at` IS NOT NULL AND `voided_by_id` IS NOT NULL AND `void_reason` IS NOT NULL)
  );

ALTER TABLE `stock_adjustments`
  ADD CONSTRAINT `chk_stock_adjustments_delta_nonzero` CHECK (`quantity_delta` <> 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- Role ↔ base consistency (a CHECK cannot look up the role code)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER `trg_users_role_base_bi` BEFORE INSERT ON `users` FOR EACH ROW
BEGIN
  DECLARE role_code VARCHAR(32);
  SELECT `code` INTO role_code FROM `roles` WHERE `id` = NEW.`role_id`;
  IF (role_code = 'ADMIN' AND NEW.`base_id` IS NOT NULL)
     OR (role_code <> 'ADMIN' AND NEW.`base_id` IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: ADMIN must have no base; other roles require a base';
  END IF;
END;

CREATE TRIGGER `trg_users_role_base_bu` BEFORE UPDATE ON `users` FOR EACH ROW
BEGIN
  DECLARE role_code VARCHAR(32);
  SELECT `code` INTO role_code FROM `roles` WHERE `id` = NEW.`role_id`;
  IF (role_code = 'ADMIN' AND NEW.`base_id` IS NOT NULL)
     OR (role_code <> 'ADMIN' AND NEW.`base_id` IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: ADMIN must have no base; other roles require a base';
  END IF;
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- Append-only history: ledger and audit log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER `trg_inventory_movements_no_update` BEFORE UPDATE ON `inventory_movements` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: inventory_movements is append-only';

CREATE TRIGGER `trg_inventory_movements_no_delete` BEFORE DELETE ON `inventory_movements` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: inventory_movements is append-only';

CREATE TRIGGER `trg_audit_logs_no_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: audit_logs is append-only';

CREATE TRIGGER `trg_audit_logs_no_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: audit_logs is append-only';

-- ─────────────────────────────────────────────────────────────────────────────
-- Business documents: never deleted; quantity-bearing fields never rewritten.
-- Corrections go through void/cancel, which only touch status + void/cancel fields.
-- reference_no may be set once (it is derived from the id right after insert).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER `trg_purchases_no_delete` BEFORE DELETE ON `purchases` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: purchases cannot be deleted; void instead';

CREATE TRIGGER `trg_purchases_immutable` BEFORE UPDATE ON `purchases` FOR EACH ROW
BEGIN
  IF OLD.`status` = 'VOIDED'
     OR NOT (OLD.`base_id` <=> NEW.`base_id` AND OLD.`equipment_id` <=> NEW.`equipment_id`
             AND OLD.`quantity` <=> NEW.`quantity` AND OLD.`unit_cost` <=> NEW.`unit_cost`
             AND OLD.`purchased_at` <=> NEW.`purchased_at` AND OLD.`created_by_id` <=> NEW.`created_by_id`
             AND OLD.`created_at` <=> NEW.`created_at`)
     OR (OLD.`reference_no` IS NOT NULL AND NOT (OLD.`reference_no` <=> NEW.`reference_no`)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: posted purchase fields are immutable';
  END IF;
END;

CREATE TRIGGER `trg_transfers_no_delete` BEFORE DELETE ON `transfers` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: transfers cannot be deleted; cancel instead';

CREATE TRIGGER `trg_transfers_immutable` BEFORE UPDATE ON `transfers` FOR EACH ROW
BEGIN
  IF OLD.`status` = 'CANCELLED'
     OR NOT (OLD.`from_base_id` <=> NEW.`from_base_id` AND OLD.`to_base_id` <=> NEW.`to_base_id`
             AND OLD.`equipment_id` <=> NEW.`equipment_id` AND OLD.`quantity` <=> NEW.`quantity`
             AND OLD.`transferred_at` <=> NEW.`transferred_at` AND OLD.`created_by_id` <=> NEW.`created_by_id`
             AND OLD.`created_at` <=> NEW.`created_at`)
     OR (OLD.`reference_no` IS NOT NULL AND NOT (OLD.`reference_no` <=> NEW.`reference_no`)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: completed transfer fields are immutable';
  END IF;
END;

CREATE TRIGGER `trg_expenditures_no_delete` BEFORE DELETE ON `expenditures` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: expenditures cannot be deleted; void instead';

CREATE TRIGGER `trg_expenditures_immutable` BEFORE UPDATE ON `expenditures` FOR EACH ROW
BEGIN
  IF OLD.`status` = 'VOIDED'
     OR NOT (OLD.`base_id` <=> NEW.`base_id` AND OLD.`equipment_id` <=> NEW.`equipment_id`
             AND OLD.`asset_id` <=> NEW.`asset_id` AND OLD.`assignment_id` <=> NEW.`assignment_id`
             AND OLD.`quantity` <=> NEW.`quantity` AND OLD.`reason` <=> NEW.`reason`
             AND OLD.`expended_at` <=> NEW.`expended_at` AND OLD.`created_by_id` <=> NEW.`created_by_id`
             AND OLD.`created_at` <=> NEW.`created_at`)
     OR (OLD.`reference_no` IS NOT NULL AND NOT (OLD.`reference_no` <=> NEW.`reference_no`)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: posted expenditure fields are immutable';
  END IF;
END;

CREATE TRIGGER `trg_assignments_no_delete` BEFORE DELETE ON `assignments` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: assignments cannot be deleted';

CREATE TRIGGER `trg_assignments_immutable` BEFORE UPDATE ON `assignments` FOR EACH ROW
BEGIN
  IF NOT (OLD.`base_id` <=> NEW.`base_id` AND OLD.`equipment_id` <=> NEW.`equipment_id`
          AND OLD.`asset_id` <=> NEW.`asset_id` AND OLD.`quantity` <=> NEW.`quantity`
          AND OLD.`assignee_service_no` <=> NEW.`assignee_service_no`
          AND OLD.`assigned_at` <=> NEW.`assigned_at` AND OLD.`created_by_id` <=> NEW.`created_by_id`
          AND OLD.`created_at` <=> NEW.`created_at`)
     OR (OLD.`reference_no` IS NOT NULL AND NOT (OLD.`reference_no` <=> NEW.`reference_no`)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: assignment core fields are immutable';
  END IF;
END;

CREATE TRIGGER `trg_assignment_returns_no_update` BEFORE UPDATE ON `assignment_returns` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: assignment_returns is append-only';

CREATE TRIGGER `trg_assignment_returns_no_delete` BEFORE DELETE ON `assignment_returns` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: assignment_returns is append-only';

CREATE TRIGGER `trg_stock_adjustments_no_delete` BEFORE DELETE ON `stock_adjustments` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: stock_adjustments is append-only';

CREATE TRIGGER `trg_stock_adjustments_immutable` BEFORE UPDATE ON `stock_adjustments` FOR EACH ROW
BEGIN
  IF NOT (OLD.`base_id` <=> NEW.`base_id` AND OLD.`equipment_id` <=> NEW.`equipment_id`
          AND OLD.`quantity_delta` <=> NEW.`quantity_delta` AND OLD.`reason` <=> NEW.`reason`
          AND OLD.`occurred_at` <=> NEW.`occurred_at` AND OLD.`notes` <=> NEW.`notes`
          AND OLD.`created_by_id` <=> NEW.`created_by_id` AND OLD.`created_at` <=> NEW.`created_at`)
     OR (OLD.`reference_no` IS NOT NULL AND NOT (OLD.`reference_no` <=> NEW.`reference_no`)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: stock_adjustments is append-only';
  END IF;
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- Master data that history depends on
-- ─────────────────────────────────────────────────────────────────────────────

-- Switching SERIALIZED <-> QUANTITY after stock exists would orphan Asset rows or
-- leave unserialized stock of a serialized item.
CREATE TRIGGER `trg_equipment_tracking_type_locked` BEFORE UPDATE ON `equipment` FOR EACH ROW
BEGIN
  IF NOT (OLD.`tracking_type` <=> NEW.`tracking_type`)
     AND EXISTS (SELECT 1 FROM `inventory_movements` WHERE `equipment_id` = OLD.`id` LIMIT 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: tracking_type cannot change once stock exists';
  END IF;
END;

CREATE TRIGGER `trg_assets_identity_immutable` BEFORE UPDATE ON `assets` FOR EACH ROW
BEGIN
  IF NOT (OLD.`equipment_id` <=> NEW.`equipment_id` AND OLD.`serial_number` <=> NEW.`serial_number`) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: asset equipment and serial number are immutable';
  END IF;
END;

CREATE TRIGGER `trg_assets_no_delete` BEFORE DELETE ON `assets` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'MAMS_INTEGRITY: assets cannot be deleted';
