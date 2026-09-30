import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { findInventoryDiscrepancies } from '../../src/modules/inventory/inventory.reconcile.js';
import { expectError } from '../helpers.js';
import { createWorld } from '../world.js';

/**
 * Transaction rollback. The audit row is written inside the business transaction,
 * after the document and its ledger rows. Making that one statement fail — with a
 * real database error, on the same transaction client — must undo everything
 * written before it. (vi.mock is scoped to this test file.)
 */
const failNext = vi.hoisted(() => ({ action: null }));
vi.mock('../../src/modules/audit/audit.service.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    recordAudit(tx, entry) {
      if (entry.action === failNext.action) {
        failNext.action = null;
        // NOT NULL violation → MySQL error inside the open transaction.
        return tx.$executeRaw`INSERT INTO audit_logs (action, entity_type) VALUES (NULL, 'Test')`;
      }
      return original.recordAudit(tx, entry);
    },
  };
});

let w;
let log1;
let cmdr1;

beforeAll(async () => {
  w = await createWorld('RBK');
  [log1, cmdr1] = await Promise.all(['log1', 'cmdr1'].map((k) => w.as(k)));
  await w.stock('B1', 'ammo', 1000);
});

const snapshot = async () => ({
  purchases: await prisma.purchase.count({ where: { baseId: w.bases.B1 } }),
  movements: await prisma.inventoryMovement.count({ where: { baseId: w.bases.B1 } }),
  audits: await prisma.auditLog.count({ where: { baseId: w.bases.B1, action: 'PURCHASE_CREATED' } }),
  balance: await w.balance('B1', 'ammo'),
});

describe('purchase transaction rollback', () => {
  it('a failure after the purchase and ledger rows were written leaves no trace', async () => {
    const before = await snapshot();

    failNext.action = 'PURCHASE_CREATED';
    const res = await log1.post('/api/purchases', { equipmentId: w.equipment.ammo, quantity: 250 });
    expectError(res, 500, 'INTERNAL_ERROR');

    expect(await snapshot()).toEqual(before);
  });

  it('the Idempotency-Key of a failed request is released, so the retry succeeds exactly once', async () => {
    const before = await snapshot();
    const headers = { 'Idempotency-Key': 'rbk-retry-key-0001' };
    const body = { equipmentId: w.equipment.ammo, quantity: 40 };

    failNext.action = 'PURCHASE_CREATED';
    expectError(await log1.post('/api/purchases', body, headers), 500, 'INTERNAL_ERROR');
    const retry = await log1.post('/api/purchases', body, headers);

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    const after = await snapshot();
    expect(after.purchases).toBe(before.purchases + 1);
    expect(after.balance.onHand).toBe(before.balance.onHand + 40);
  });
});

describe('transfer completion rollback', () => {
  it('a failure after the status change and ledger rows leaves the transfer PENDING and stock untouched', async () => {
    const created = await log1.post('/api/transfers', { destinationBaseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: 100 });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const [src, dst] = [await w.balance('B1', 'ammo'), await w.balance('B2', 'ammo')];

    failNext.action = 'TRANSFER_COMPLETED';
    expectError(await cmdr1.post(`/api/transfers/${id}/complete`), 500, 'INTERNAL_ERROR');

    const transfer = await prisma.transfer.findUnique({ where: { id } });
    expect(transfer).toMatchObject({ status: 'PENDING', completedAt: null, completedById: null });
    expect(await prisma.inventoryMovement.count({ where: { transferId: id } })).toBe(0);
    expect(await w.balance('B1', 'ammo')).toEqual(src);
    expect(await w.balance('B2', 'ammo')).toEqual(dst);

    // Still completable once the fault is gone.
    const retry = await cmdr1.post(`/api/transfers/${id}/complete`);
    expect(retry.status).toBe(200);
    expect(await w.balance('B1', 'ammo')).toEqual({ onHand: src.onHand - 100, assigned: 0 });
    expect(await w.balance('B2', 'ammo')).toEqual({ onHand: dst.onHand + 100, assigned: 0 });
  });
});

describe('expenditure rollback', () => {
  it('a failed expenditure leaves on-hand, the ledger and the expenditure table unchanged', async () => {
    const before = {
      balance: await w.balance('B1', 'ammo'),
      expenditures: await prisma.expenditure.count({ where: { baseId: w.bases.B1 } }),
      movements: await prisma.inventoryMovement.count({ where: { baseId: w.bases.B1, type: 'EXPENDITURE' } }),
    };

    failNext.action = 'EXPENDITURE_POSTED';
    const res = await cmdr1.post('/api/expenditures', { equipmentId: w.equipment.ammo, quantity: 5, reason: 'TRAINING' });
    expectError(res, 500, 'INTERNAL_ERROR');

    expect({
      balance: await w.balance('B1', 'ammo'),
      expenditures: await prisma.expenditure.count({ where: { baseId: w.bases.B1 } }),
      movements: await prisma.inventoryMovement.count({ where: { baseId: w.bases.B1, type: 'EXPENDITURE' } }),
    }).toEqual(before);
  });
});

describe('after all of the above', () => {
  it('the Inventory projection still reconciles with the ledger, assignments and assets', async () => {
    expect(await findInventoryDiscrepancies(prisma)).toEqual([]);
  });
});
