/**
 * Inventory posting service — the ONLY code allowed to write `inventory_movements`,
 * `inventory`, `assets` status/location, and the stock-bearing transaction tables.
 *
 * Every operation runs in one DB transaction that writes the document, its ledger
 * rows, asset changes, the audit row and the Inventory projection — all or nothing.
 *
 * Concurrency design
 *   - Stock checks are conditional UPDATEs on `inventory` (the WHERE clause is the
 *     check), so there is no read-then-write window. If the guard fails, the whole
 *     transaction rolls back.
 *   - `inventory` rows are the hot rows (every movement of a bulk item at a base hits
 *     the same row), so they are touched LAST: the lock is held only from that UPDATE
 *     to COMMIT, not across the document inserts.
 *   - Serialized assets are locked FIRST with SELECT … FOR UPDATE, because inserting
 *     rows that reference an asset takes a shared FK lock on it; taking the exclusive
 *     lock up front avoids S→X upgrade deadlocks.
 *   - Lock order everywhere: transfer or assignment row → asset rows (ascending id)
 *     → inventory rows (ascending base_id).
 *   - State transitions (transfer complete/cancel) lock the document row FIRST and
 *     re-check its status under the lock, so concurrent or repeated requests are
 *     serialized and only the first one can act.
 *
 * These are domain primitives. Authorization (role permissions, base scope) and
 * request validation are the caller's job; this layer enforces stock invariants.
 *
 * `actor` = { id, email, role }  ·  `context` = { requestId?, ip?, userAgent? }
 */
import { Prisma } from '../../generated/prisma/client.ts';
import { withTransaction } from '../../utils/transaction.js';
import { badRequest, conflict, insufficientStock, notFound, unprocessable } from '../../utils/errors.js';
import { recordAudit } from '../audit/audit.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Admin stock correction; also how opening stock is loaded.
 * SERIALIZED: pass `serialNumbers` (creates assets, positive only).
 * QUANTITY:   pass a signed, non-zero `quantityDelta`.
 */
export function postStockAdjustment(actor, input, context = {}) {
  const occurredAt = toDate(input.occurredAt, 'occurredAt');

  return withTransaction(async (tx) => {
    await getActiveBase(tx, input.baseId);
    const equipment = await getActiveEquipment(tx, input.equipmentId);

    let quantityDelta;
    let serialNumbers = [];
    if (equipment.trackingType === 'SERIALIZED') {
      if (input.quantityDelta !== undefined && input.quantityDelta < 0) {
        throw badRequest('Serialized stock is removed through an expenditure, not a negative adjustment');
      }
      serialNumbers = normalizeSerials(input.serialNumbers);
      quantityDelta = serialNumbers.length;
    } else {
      rejectSerialInput(input);
      quantityDelta = requireInt(input.quantityDelta, 'quantityDelta', { allowNegative: true });
    }

    const created = await tx.stockAdjustment.create({
      data: {
        baseId: input.baseId,
        equipmentId: input.equipmentId,
        quantityDelta,
        reason: input.reason,
        occurredAt,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });
    const adjustment = await assignReference(tx, 'stockAdjustment', 'ADJ', created, occurredAt);

    const common = {
      baseId: input.baseId,
      equipmentId: input.equipmentId,
      type: 'ADJUSTMENT',
      occurredAt,
      adjustmentId: adjustment.id,
      createdById: actor.id,
    };
    const assets = serialNumbers.length
      ? await createAssets(tx, { equipmentId: input.equipmentId, baseId: input.baseId, serialNumbers })
      : [];
    await tx.inventoryMovement.createMany({
      data: assets.length
        ? assets.map((a) => ({ ...common, assetId: a.id, quantityDelta: 1 }))
        : [{ ...common, quantityDelta }],
    });

    await recordAudit(tx, {
      actor,
      action: 'STOCK_ADJUSTMENT_POSTED',
      entityType: 'StockAdjustment',
      entityId: adjustment.id,
      baseId: input.baseId,
      after: adjustment,
      metadata: serialNumbers.length ? { serialNumbers } : undefined,
      context,
    });

    if (quantityDelta > 0) {
      await addOnHand(tx, input.baseId, input.equipmentId, quantityDelta);
    } else {
      await changeStock(tx, {
        baseId: input.baseId,
        equipmentId: input.equipmentId,
        onHand: quantityDelta,
        requireAvailable: -quantityDelta,
      });
    }
    return adjustment;
  });
}

/** SERIALIZED: pass `serialNumbers` (quantity = count). QUANTITY: pass `quantity`. */
export function postPurchase(actor, input, context = {}) {
  const purchasedAt = toDate(input.purchasedAt, 'purchasedAt');

  return withTransaction(async (tx) => {
    await getActiveBase(tx, input.baseId);
    const equipment = await getActiveEquipment(tx, input.equipmentId);
    const { quantity, serialNumbers } = resolveInboundQuantity(equipment, input);

    const created = await tx.purchase.create({
      data: {
        baseId: input.baseId,
        equipmentId: input.equipmentId,
        quantity,
        unitCost: input.unitCost ?? null,
        supplierName: input.supplierName ?? null,
        purchaseOrderNo: input.purchaseOrderNo ?? null,
        purchasedAt,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });
    const purchase = await assignReference(tx, 'purchase', 'PUR', created, purchasedAt);

    const common = {
      baseId: input.baseId,
      equipmentId: input.equipmentId,
      type: 'PURCHASE',
      occurredAt: purchasedAt,
      purchaseId: purchase.id,
      createdById: actor.id,
    };
    const assets = serialNumbers.length
      ? await createAssets(tx, { equipmentId: input.equipmentId, baseId: input.baseId, serialNumbers })
      : [];
    await tx.inventoryMovement.createMany({
      data: assets.length
        ? assets.map((a) => ({ ...common, assetId: a.id, quantityDelta: 1 }))
        : [{ ...common, quantityDelta: quantity }],
    });

    await recordAudit(tx, {
      actor,
      action: 'PURCHASE_CREATED',
      entityType: 'Purchase',
      entityId: purchase.id,
      baseId: input.baseId,
      after: purchase,
      metadata: serialNumbers.length ? { serialNumbers } : undefined,
      context,
    });

    await addOnHand(tx, input.baseId, input.equipmentId, quantity);
    return purchase;
  });
}

/**
 * Step 1 of a transfer: records a PENDING request. No stock moves and nothing is
 * reserved; availability is checked here to fail fast, and re-checked atomically
 * when the transfer completes.
 * SERIALIZED: pass `assetIds` (the exact units to send). QUANTITY: pass `quantity`.
 * `createdAt` may be passed only by internal callers (the seed) to record history.
 */
export function createTransfer(actor, input, context = {}) {
  const { sourceBaseId, destinationBaseId, equipmentId } = input;
  if (sourceBaseId === destinationBaseId) throw badRequest('Source and destination base must differ');
  const createdAt = input.createdAt ? toDate(input.createdAt, 'createdAt') : undefined;

  return withTransaction(async (tx) => {
    await getActiveBase(tx, sourceBaseId, 'Source base');
    await getActiveBase(tx, destinationBaseId, 'Destination base');
    const equipment = await getActiveEquipment(tx, equipmentId);

    let quantity;
    let assets = [];
    if (equipment.trackingType === 'SERIALIZED') {
      const assetIds = requireIdList(input.assetIds, 'assetIds');
      quantity = assetIds.length;
      if (input.quantity !== undefined && input.quantity !== quantity) {
        throw badRequest('quantity must equal the number of assetIds');
      }
      assets = await findAssets(tx, assetIds);
      assertAssets(assets, { equipmentId, baseId: sourceBaseId, status: 'AVAILABLE' });
      const alreadyPending = await tx.transferAsset.findMany({
        where: { assetId: { in: assetIds }, transfer: { status: 'PENDING' } },
        select: { asset: { select: { serialNumber: true } }, transfer: { select: { referenceNo: true } } },
      });
      if (alreadyPending.length) {
        throw conflict('ASSET_IN_PENDING_TRANSFER', 'Asset is already on another pending transfer', {
          assets: alreadyPending.map((p) => ({ serialNumber: p.asset.serialNumber, transfer: p.transfer.referenceNo })),
        });
      }
    } else {
      rejectSerialInput(input);
      quantity = requireInt(input.quantity, 'quantity');
      const row = await tx.inventory.findUnique({ where: { baseId_equipmentId: { baseId: sourceBaseId, equipmentId } } });
      const available = row ? row.quantityOnHand - row.quantityAssigned : 0;
      if (available < quantity) throw insufficientStock({ baseId: sourceBaseId, equipmentId, available, requested: quantity });
    }

    const created = await tx.transfer.create({
      data: {
        sourceBaseId,
        destinationBaseId,
        equipmentId,
        quantity,
        notes: input.notes ?? null,
        createdById: actor.id,
        ...(createdAt ? { createdAt } : {}),
      },
    });
    const transfer = await assignReference(tx, 'transfer', 'TRF', created, created.createdAt);
    if (assets.length) {
      await tx.transferAsset.createMany({ data: assets.map((a) => ({ transferId: transfer.id, assetId: a.id })) });
    }

    await recordAudit(tx, {
      actor,
      action: 'TRANSFER_CREATED',
      entityType: 'Transfer',
      entityId: transfer.id,
      baseId: sourceBaseId,
      after: transfer,
      metadata: {
        destinationBaseId,
        ...(assets.length ? { serialNumbers: assets.map((a) => a.serialNumber) } : {}),
      },
      context,
    });
    return transfer;
  });
}

/**
 * Step 2: moves the stock. In ONE transaction: lock the transfer row, verify it is
 * still PENDING, flip it to COMPLETED, write TRANSFER_OUT + TRANSFER_IN ledger rows,
 * relocate serialized assets, write the audit row, then decrement the source and
 * increment the destination Inventory rows. Any failure rolls back all of it.
 *
 * Duplicate protection: the row lock serializes concurrent completions, so the
 * second one waits, then sees COMPLETED and gets 409. The status update is also
 * conditional (WHERE status = 'PENDING') and a DB trigger rejects any change to a
 * non-pending transfer, so stock can never move twice for one transfer.
 * `completedAt` may be passed only by internal callers (the seed).
 */
export function completeTransfer(actor, input, context = {}) {
  const completedAt = toDate(input.completedAt, 'completedAt');

  return withTransaction(async (tx) => {
    const transfer = await lockTransfer(tx, input.transferId);
    assertPending(transfer, 'complete');
    // Only for an explicit (historical) date: "now" vs a DB-generated createdAt may differ by clock skew.
    if (input.completedAt && completedAt < transfer.createdAt) {
      throw badRequest('completedAt cannot be before the transfer was created');
    }
    const { id: transferId, sourceBaseId, destinationBaseId, equipmentId, quantity } = transfer;

    await getActiveBase(tx, sourceBaseId, 'Source base');
    await getActiveBase(tx, destinationBaseId, 'Destination base');
    await getActiveEquipment(tx, equipmentId);

    const items = await tx.transferAsset.findMany({ where: { transferId }, select: { assetId: true } });
    const assets = items.length ? await lockAssets(tx, items.map((i) => i.assetId)) : [];
    assertAssets(assets, { equipmentId, baseId: sourceBaseId, status: 'AVAILABLE' });

    const { count } = await tx.transfer.updateMany({
      where: { id: transferId, status: 'PENDING' },
      data: { status: 'COMPLETED', completedAt, completedById: actor.id },
    });
    if (count !== 1) throw conflict('TRANSFER_ALREADY_COMPLETED', 'Transfer has already been completed');
    const updated = await tx.transfer.findUnique({ where: { id: transferId } });

    const common = { equipmentId, occurredAt: completedAt, transferId, createdById: actor.id };
    const out = { ...common, baseId: sourceBaseId, type: 'TRANSFER_OUT' };
    const inbound = { ...common, baseId: destinationBaseId, type: 'TRANSFER_IN' };
    await tx.inventoryMovement.createMany({
      data: assets.length
        ? assets.flatMap((a) => [
            { ...out, assetId: a.id, quantityDelta: -1 },
            { ...inbound, assetId: a.id, quantityDelta: 1 },
          ])
        : [
            { ...out, quantityDelta: -quantity },
            { ...inbound, quantityDelta: quantity },
          ],
    });
    if (assets.length) {
      await tx.asset.updateMany({ where: { id: { in: assets.map((a) => a.id) } }, data: { currentBaseId: destinationBaseId } });
    }

    await recordAudit(tx, {
      actor,
      action: 'TRANSFER_COMPLETED',
      entityType: 'Transfer',
      entityId: transferId,
      baseId: sourceBaseId,
      before: pickTransferState(transfer),
      after: pickTransferState(updated),
      metadata: {
        destinationBaseId,
        quantity,
        ...(assets.length ? { serialNumbers: assets.map((a) => a.serialNumber) } : {}),
      },
      context,
    });

    // Hot rows last, in ascending base order.
    const withdraw = () => changeStock(tx, { baseId: sourceBaseId, equipmentId, onHand: -quantity, requireAvailable: quantity });
    const deposit = () => addOnHand(tx, destinationBaseId, equipmentId, quantity);
    for (const step of sourceBaseId < destinationBaseId ? [withdraw, deposit] : [deposit, withdraw]) await step();

    return updated;
  });
}

/** Withdraws a PENDING transfer. No stock has moved, so nothing is reversed. */
export function cancelTransfer(actor, input, context = {}) {
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw badRequest('A cancellation reason is required');

  return withTransaction(async (tx) => {
    const transfer = await lockTransfer(tx, input.transferId);
    assertPending(transfer, 'cancel');

    const { count } = await tx.transfer.updateMany({
      where: { id: transfer.id, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: actor.id, cancelReason: reason.slice(0, 500) },
    });
    if (count !== 1) throw conflict('TRANSFER_NOT_PENDING', 'Transfer is no longer pending');
    const updated = await tx.transfer.findUnique({ where: { id: transfer.id } });

    await recordAudit(tx, {
      actor,
      action: 'TRANSFER_CANCELLED',
      entityType: 'Transfer',
      entityId: transfer.id,
      baseId: transfer.sourceBaseId,
      before: pickTransferState(transfer),
      after: pickTransferState(updated),
      metadata: { reason: updated.cancelReason },
      context,
    });
    return updated;
  });
}

/**
 * Issues stock to a person. On-hand and the ledger are unchanged; only
 * `Inventory.quantityAssigned` (and the asset's status) move.
 * SERIALIZED: pass `assetId`. QUANTITY: pass `quantity`.
 */
export function createAssignment(actor, input, context = {}) {
  const assignedAt = toDate(input.assignedAt, 'assignedAt');
  const expectedReturnAt = input.expectedReturnAt ? toDate(input.expectedReturnAt, 'expectedReturnAt', { allowFuture: true }) : null;
  if (expectedReturnAt && expectedReturnAt < assignedAt) {
    throw badRequest('expectedReturnAt cannot be before assignedAt');
  }

  return withTransaction(async (tx) => {
    await getActiveBase(tx, input.baseId);
    const equipment = await getActiveEquipment(tx, input.equipmentId);

    let quantity = 1;
    let asset = null;
    if (equipment.trackingType === 'SERIALIZED') {
      if (input.quantity !== undefined && input.quantity !== 1) throw badRequest('Serialized assignments are for exactly one asset');
      [asset] = await lockAssets(tx, [requireInt(input.assetId, 'assetId')]);
      assertAssets([asset], { equipmentId: input.equipmentId, baseId: input.baseId, status: 'AVAILABLE' });
    } else {
      if (input.assetId != null) throw badRequest('assetId is only valid for serialized equipment');
      quantity = requireInt(input.quantity, 'quantity');
    }

    const created = await tx.assignment.create({
      data: {
        baseId: input.baseId,
        equipmentId: input.equipmentId,
        assetId: asset?.id ?? null,
        quantity,
        assigneeName: input.assigneeName,
        assigneeServiceNo: input.assigneeServiceNo,
        assigneeUnit: input.assigneeUnit ?? null,
        purpose: input.purpose ?? null,
        assignedAt,
        expectedReturnAt,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });
    const assignment = await assignReference(tx, 'assignment', 'ASG', created, assignedAt);
    if (asset) await tx.asset.update({ where: { id: asset.id }, data: { status: 'ASSIGNED' } });

    await recordAudit(tx, {
      actor,
      action: 'ASSIGNMENT_CREATED',
      entityType: 'Assignment',
      entityId: assignment.id,
      baseId: input.baseId,
      after: assignment,
      metadata: asset ? { serialNumber: asset.serialNumber } : undefined,
      context,
    });

    await changeStock(tx, {
      baseId: input.baseId,
      equipmentId: input.equipmentId,
      assigned: quantity,
      requireAvailable: quantity,
    });
    return assignment;
  });
}

/** Records a (possibly partial) return. Serialized assignments return their single asset. */
export function returnAssignment(actor, input, context = {}) {
  const returnedAt = toDate(input.returnedAt, 'returnedAt');

  return withTransaction(async (tx) => {
    const assignment = await lockAssignment(tx, input.assignmentId);
    const outstanding = outstandingOf(assignment);
    const quantity = assignment.assetId ? outstanding : requireInt(input.quantity, 'quantity');
    if (quantity > outstanding) {
      throw conflict('RETURN_EXCEEDS_OUTSTANDING', 'Return quantity exceeds the outstanding quantity', { outstanding });
    }
    if (returnedAt < assignment.assignedAt) throw badRequest('returnedAt cannot be before assignedAt');

    if (assignment.assetId) {
      const [asset] = await lockAssets(tx, [assignment.assetId]);
      assertAssets([asset], { equipmentId: assignment.equipmentId, baseId: assignment.baseId, status: 'ASSIGNED' });
      await tx.asset.update({ where: { id: asset.id }, data: { status: 'AVAILABLE' } });
    }

    const assignmentReturn = await tx.assignmentReturn.create({
      data: {
        assignmentId: assignment.id,
        quantity,
        condition: input.condition ?? 'SERVICEABLE',
        returnedAt,
        notes: input.notes ?? null,
        receivedById: actor.id,
      },
    });
    const updated = await settleAssignment(tx, assignment, { returned: quantity }, returnedAt);

    await recordAudit(tx, {
      actor,
      action: 'ASSIGNMENT_RETURNED',
      entityType: 'Assignment',
      entityId: assignment.id,
      baseId: assignment.baseId,
      before: pickAssignmentState(assignment),
      after: pickAssignmentState(updated),
      metadata: { assignmentReturnId: assignmentReturn.id, quantity, condition: assignmentReturn.condition },
      context,
    });

    await changeStock(tx, {
      baseId: assignment.baseId,
      equipmentId: assignment.equipmentId,
      assigned: -quantity,
      requireAssigned: quantity,
    });
    return { assignment: updated, assignmentReturn };
  });
}

/**
 * Consumes stock. With `assignmentId`, the quantity is taken from what the assignee
 * holds (reduces both on-hand and assigned); otherwise from available stock.
 * SERIALIZED without an assignment: pass `assetId`.
 */
export function postExpenditure(actor, input, context = {}) {
  const expendedAt = toDate(input.expendedAt, 'expendedAt');

  return withTransaction(async (tx) => {
    let assignment = null;
    let { baseId, equipmentId } = input;

    if (input.assignmentId != null) {
      assignment = await lockAssignment(tx, input.assignmentId);
      if ((baseId != null && baseId !== assignment.baseId) || (equipmentId != null && equipmentId !== assignment.equipmentId)) {
        throw badRequest('baseId/equipmentId do not match the assignment');
      }
      baseId = assignment.baseId;
      equipmentId = assignment.equipmentId;
      if (expendedAt < assignment.assignedAt) throw badRequest('expendedAt cannot be before assignedAt');
    }

    await getActiveBase(tx, baseId);
    const equipment = await getActiveEquipment(tx, equipmentId);

    let quantity;
    let asset = null;
    if (equipment.trackingType === 'SERIALIZED') {
      const assetId = assignment ? assignment.assetId : requireInt(input.assetId, 'assetId');
      if (input.assetId != null && input.assetId !== assetId) throw badRequest('assetId does not match the assignment');
      quantity = 1;
      [asset] = await lockAssets(tx, [assetId]);
      assertAssets([asset], { equipmentId, baseId, status: assignment ? 'ASSIGNED' : 'AVAILABLE' });
    } else {
      if (input.assetId != null) throw badRequest('assetId is only valid for serialized equipment');
      quantity = requireInt(input.quantity, 'quantity');
    }

    if (assignment && quantity > outstandingOf(assignment)) {
      throw conflict('EXPENDITURE_EXCEEDS_OUTSTANDING', 'Quantity exceeds what the assignee holds', {
        outstanding: outstandingOf(assignment),
      });
    }

    const created = await tx.expenditure.create({
      data: {
        baseId,
        equipmentId,
        assetId: asset?.id ?? null,
        assignmentId: assignment?.id ?? null,
        quantity,
        reason: input.reason,
        expendedAt,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    });
    const expenditure = await assignReference(tx, 'expenditure', 'EXP', created, expendedAt);

    await tx.inventoryMovement.create({
      data: {
        baseId,
        equipmentId,
        assetId: asset?.id ?? null,
        type: 'EXPENDITURE',
        quantityDelta: -quantity,
        occurredAt: expendedAt,
        expenditureId: expenditure.id,
        createdById: actor.id,
      },
    });
    if (asset) await tx.asset.update({ where: { id: asset.id }, data: { status: 'EXPENDED' } });
    if (assignment) await settleAssignment(tx, assignment, { expended: quantity }, expendedAt);

    await recordAudit(tx, {
      actor,
      action: 'EXPENDITURE_POSTED',
      entityType: 'Expenditure',
      entityId: expenditure.id,
      baseId,
      after: expenditure,
      metadata: {
        ...(asset ? { serialNumber: asset.serialNumber } : {}),
        ...(assignment ? { assignmentId: assignment.id, assignmentReference: assignment.referenceNo } : {}),
      },
      context,
    });

    await changeStock(tx, assignment
      ? { baseId, equipmentId, onHand: -quantity, assigned: -quantity, requireAssigned: quantity }
      : { baseId, equipmentId, onHand: -quantity, requireAvailable: quantity });
    return expenditure;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Inventory projection (hot rows — call last, in ascending base order)
// ─────────────────────────────────────────────────────────────────────────────

/** Adds on-hand stock, creating the Inventory row on first use. Cannot fail on stock. */
function addOnHand(tx, baseId, equipmentId, quantity) {
  return tx.$executeRaw`
    INSERT INTO inventory (base_id, equipment_id, quantity_on_hand, quantity_assigned, version, created_at, updated_at)
    VALUES (${baseId}, ${equipmentId}, ${quantity}, 0, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE
      quantity_on_hand = quantity_on_hand + ${quantity},
      version = version + 1,
      updated_at = UTC_TIMESTAMP(3)`;
}

/**
 * Applies a guarded change in ONE statement — the WHERE clause is the stock check,
 * so no other transaction can act between check and write.
 *   requireAvailable: on-hand − assigned must be ≥ this before the change
 *   requireAssigned:  assigned must be ≥ this before the change
 * A missing row means zero stock, so the guard fails the same way.
 */
async function changeStock(tx, { baseId, equipmentId, onHand = 0, assigned = 0, requireAvailable = 0, requireAssigned = 0 }) {
  const affected = await tx.$executeRaw`
    UPDATE inventory
    SET quantity_on_hand = quantity_on_hand + ${onHand},
        quantity_assigned = quantity_assigned + ${assigned},
        version = version + 1,
        updated_at = UTC_TIMESTAMP(3)
    WHERE base_id = ${baseId} AND equipment_id = ${equipmentId}
      AND quantity_on_hand - quantity_assigned >= ${requireAvailable}
      AND quantity_assigned >= ${requireAssigned}`;
  if (affected === 1) return;

  const row = await tx.inventory.findUnique({ where: { baseId_equipmentId: { baseId, equipmentId } } });
  throw insufficientStock({
    baseId,
    equipmentId,
    available: row ? row.quantityOnHand - row.quantityAssigned : 0,
    assigned: row?.quantityAssigned ?? 0,
    requested: requireAvailable || requireAssigned,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Row locks (low-contention rows — taken first)
// ─────────────────────────────────────────────────────────────────────────────

async function lockAssets(tx, assetIds) {
  const ids = [...assetIds].sort((a, b) => a - b);
  const rows = await tx.$queryRaw`
    SELECT id, equipment_id AS equipmentId, current_base_id AS currentBaseId, status, serial_number AS serialNumber
    FROM assets
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id
    FOR UPDATE`;
  return checkAssetsFound(ids, rows.map((r) => ({
    id: Number(r.id),
    equipmentId: Number(r.equipmentId),
    currentBaseId: Number(r.currentBaseId),
    status: r.status,
    serialNumber: r.serialNumber,
  })));
}

/** Non-locking read, for validating a request that does not move stock yet. */
async function findAssets(tx, assetIds) {
  const rows = await tx.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, equipmentId: true, currentBaseId: true, status: true, serialNumber: true },
    orderBy: { id: 'asc' },
  });
  return checkAssetsFound(assetIds, rows);
}

/** A missing asset is reported exactly like one held elsewhere, so ids cannot be probed for existence. */
function checkAssetsFound(ids, rows) {
  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => r.id));
    throw conflict('ASSET_NOT_AT_BASE', 'One or more assets are not held at this base', {
      assetIds: ids.filter((id) => !found.has(id)),
    });
  }
  return rows;
}

async function lockTransfer(tx, transferId) {
  const id = requireInt(transferId, 'transferId');
  await tx.$queryRaw`SELECT id FROM transfers WHERE id = ${id} FOR UPDATE`;
  const transfer = await tx.transfer.findUnique({ where: { id } });
  if (!transfer) throw notFound('Transfer not found');
  return transfer;
}

/** Terminal states are final: a transfer is completed or cancelled at most once. */
function assertPending(transfer, action) {
  if (transfer.status === 'COMPLETED') {
    throw conflict('TRANSFER_ALREADY_COMPLETED', action === 'complete'
      ? 'Transfer has already been completed'
      : 'A completed transfer cannot be cancelled');
  }
  if (transfer.status === 'CANCELLED') {
    throw conflict('TRANSFER_CANCELLED', action === 'complete'
      ? 'A cancelled transfer cannot be completed'
      : 'Transfer has already been cancelled');
  }
}

async function lockAssignment(tx, assignmentId) {
  const id = requireInt(assignmentId, 'assignmentId');
  await tx.$queryRaw`SELECT id FROM assignments WHERE id = ${id} FOR UPDATE`;
  const assignment = await tx.assignment.findUnique({ where: { id } });
  if (!assignment) throw unprocessable('ASSIGNMENT_NOT_FOUND', 'Assignment not found');
  if (assignment.status !== 'ACTIVE') {
    throw conflict('ASSIGNMENT_NOT_ACTIVE', `Assignment is ${assignment.status.toLowerCase()}`);
  }
  return assignment;
}

// ─────────────────────────────────────────────────────────────────────────────
// Document writes
// ─────────────────────────────────────────────────────────────────────────────

/** Reference numbers are derived from the auto-increment id, so they cannot collide. */
function assignReference(tx, model, prefix, record, businessDate) {
  const referenceNo = `${prefix}-${businessDate.getUTCFullYear()}-${String(record.id).padStart(6, '0')}`;
  return tx[model].update({ where: { id: record.id }, data: { referenceNo } });
}

async function createAssets(tx, { equipmentId, baseId, serialNumbers }) {
  const existing = await tx.asset.findMany({
    where: { equipmentId, serialNumber: { in: serialNumbers } },
    select: { serialNumber: true },
  });
  if (existing.length) {
    throw conflict('DUPLICATE_SERIAL_NUMBER', 'Serial number already exists for this equipment', {
      serialNumbers: existing.map((a) => a.serialNumber),
    });
  }
  await tx.asset.createMany({
    data: serialNumbers.map((serialNumber) => ({ equipmentId, serialNumber, currentBaseId: baseId })),
  });
  // createManyAndReturn is not available on MySQL; re-read by the unique key.
  return tx.asset.findMany({
    where: { equipmentId, serialNumber: { in: serialNumbers } },
    select: { id: true, serialNumber: true },
    orderBy: { id: 'asc' },
  });
}

function settleAssignment(tx, assignment, { returned = 0, expended = 0 }, at) {
  const quantityReturned = assignment.quantityReturned + returned;
  const quantityExpended = assignment.quantityExpended + expended;
  const settled = quantityReturned + quantityExpended === assignment.quantity;
  return tx.assignment.update({
    where: { id: assignment.id },
    data: {
      quantityReturned,
      quantityExpended,
      status: settled ? (quantityExpended > 0 ? 'CLOSED' : 'RETURNED') : 'ACTIVE',
      closedAt: settled ? at : null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

// Referenced records that do not exist are 422 (the request is well-formed but
// names something unusable), not 404 (which would suggest the route is missing).
async function getActiveBase(tx, baseId, label = 'Base') {
  const base = await tx.base.findUnique({ where: { id: requireInt(baseId, 'baseId') } });
  if (!base) throw unprocessable('BASE_NOT_FOUND', `${label} not found`, { baseId });
  if (!base.isActive) throw unprocessable('BASE_INACTIVE', `${label} ${base.code} is inactive`);
  return base;
}

async function getActiveEquipment(tx, equipmentId) {
  const equipment = await tx.equipment.findUnique({ where: { id: requireInt(equipmentId, 'equipmentId') } });
  if (!equipment) throw unprocessable('EQUIPMENT_NOT_FOUND', 'Equipment not found', { equipmentId });
  if (!equipment.isActive) throw unprocessable('EQUIPMENT_INACTIVE', `Equipment ${equipment.code} is inactive`);
  return equipment;
}

function resolveInboundQuantity(equipment, input) {
  if (equipment.trackingType === 'SERIALIZED') {
    const serialNumbers = normalizeSerials(input.serialNumbers);
    if (input.quantity !== undefined && input.quantity !== serialNumbers.length) {
      throw badRequest('quantity must equal the number of serialNumbers');
    }
    return { quantity: serialNumbers.length, serialNumbers };
  }
  rejectSerialInput(input);
  return { quantity: requireInt(input.quantity, 'quantity'), serialNumbers: [] };
}

/**
 * Base membership is checked FIRST and reported without any detail: asset ids come
 * from the client, so describing an asset held elsewhere (its serial number or its
 * equipment) would let a user enumerate other bases' serialized inventory by id.
 * Only once every asset is known to be at the caller's base are details returned.
 */
function assertAssets(assets, { equipmentId, baseId, status }) {
  const elsewhere = assets.filter((a) => a.currentBaseId !== baseId);
  if (elsewhere.length) {
    throw conflict('ASSET_NOT_AT_BASE', 'One or more assets are not held at this base', {
      assetIds: elsewhere.map((a) => a.id),
    });
  }
  for (const asset of assets) {
    if (asset.equipmentId !== equipmentId) {
      throw badRequest(`Asset ${asset.serialNumber} is not of the selected equipment`);
    }
    if (asset.status !== status) {
      throw conflict('ASSET_UNAVAILABLE', `Asset ${asset.serialNumber} is ${asset.status.toLowerCase()}`);
    }
  }
}

function normalizeSerials(serialNumbers) {
  if (!Array.isArray(serialNumbers) || serialNumbers.length === 0) {
    throw badRequest('serialNumbers is required for serialized equipment');
  }
  const cleaned = serialNumbers.map((s) => String(s).trim().toUpperCase());
  if (cleaned.some((s) => !s || s.length > 100)) throw badRequest('Serial numbers must be 1–100 characters');
  if (new Set(cleaned).size !== cleaned.length) throw badRequest('Duplicate serial numbers in request');
  return cleaned;
}

function rejectSerialInput(input) {
  if (input.serialNumbers?.length || input.assetIds?.length) {
    throw badRequest('Serial numbers / assets are only valid for serialized equipment');
  }
}

function requireIdList(ids, field) {
  if (!Array.isArray(ids) || ids.length === 0) throw badRequest(`${field} is required for serialized equipment`);
  const parsed = ids.map((id) => requireInt(id, field));
  if (new Set(parsed).size !== parsed.length) throw badRequest(`Duplicate entries in ${field}`);
  return parsed;
}

function requireInt(value, field, { allowNegative = false } = {}) {
  if (!Number.isSafeInteger(value) || value === 0 || (!allowNegative && value < 0)) {
    throw badRequest(`${field} must be a ${allowNegative ? 'non-zero' : 'positive'} integer`);
  }
  return value;
}

function toDate(value, field, { allowFuture = false } = {}) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw badRequest(`${field} is not a valid date`);
  // one minute of tolerance for client clock skew
  if (!allowFuture && date.getTime() > Date.now() + 60_000) throw badRequest(`${field} cannot be in the future`);
  return date;
}

const outstandingOf = (a) => a.quantity - a.quantityReturned - a.quantityExpended;
const pickTransferState = (t) => ({
  status: t.status,
  completedAt: t.completedAt,
  completedById: t.completedById,
  cancelledAt: t.cancelledAt,
  cancelledById: t.cancelledById,
});
const pickAssignmentState = (a) => ({
  status: a.status,
  quantityReturned: a.quantityReturned,
  quantityExpended: a.quantityExpended,
  closedAt: a.closedAt,
});
