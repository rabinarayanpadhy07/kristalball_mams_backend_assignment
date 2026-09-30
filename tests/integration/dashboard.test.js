import { beforeAll, describe, expect, it } from 'vitest';
import { expectError } from '../helpers.js';
import { createWorld } from '../world.js';

/**
 * Scenario at base B1 (B2 is the transfer counterparty). Period = [-10d, now].
 *
 *   -40d  opening stock (adjustment)   ammo +100          before period
 *   -20d  purchase                     ammo +60           before period   → opening 160
 *    -5d  purchase                     ammo +50, kit +7   in period       → purchases 57
 *   now   transfer B1 → B2 (completed) ammo 30            → transferOut 30
 *   now   transfer B2 → B1 (completed) ammo 20            → transferIn 20
 *    -2d  expenditure                  ammo 10            → expended 10
 *    -1d  assignment                   ammo 5             → assigned 5 (custody, not consumption)
 *
 *   netMovement = 57 + 20 − 30 = 47 · closing = 160 + 47 − 10 = 197 (ammo 190 + kit 7)
 */
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.now();
const daysAgo = (d) => new Date(T0 - d * DAY).toISOString();

let w;
let admin;
let cmdr1;
let log1;
let from;
let to;

beforeAll(async () => {
  w = await createWorld('DSH');
  [admin, cmdr1, log1] = await Promise.all(['admin', 'cmdr1', 'log1'].map((k) => w.as(k)));
  const cmdr2 = await w.as('cmdr2');

  await w.stock('B1', 'ammo', 100, daysAgo(40));
  const purchase = (base, equipment, quantity, at) =>
    admin.post('/api/purchases', { baseId: w.bases[base], equipmentId: w.equipment[equipment], quantity, purchasedAt: at });
  await purchase('B1', 'ammo', 60, daysAgo(20));
  await purchase('B2', 'ammo', 500, daysAgo(20));
  await purchase('B1', 'ammo', 50, daysAgo(5));
  await purchase('B1', 'kit', 7, daysAgo(5));

  const out = await log1.post('/api/transfers', { destinationBaseId: w.bases.B2, equipmentId: w.equipment.ammo, quantity: 30 });
  expect((await cmdr1.post(`/api/transfers/${out.body.data.id}/complete`)).status).toBe(200);
  const inbound = await cmdr2.post('/api/transfers', { destinationBaseId: w.bases.B1, equipmentId: w.equipment.ammo, quantity: 20 });
  expect((await cmdr2.post(`/api/transfers/${inbound.body.data.id}/complete`)).status).toBe(200);

  const exp = await cmdr1.post('/api/expenditures', { equipmentId: w.equipment.ammo, quantity: 10, reason: 'TRAINING', expendedAt: daysAgo(2) });
  expect(exp.status).toBe(201);
  const asg = await cmdr1.post('/api/assignments', {
    equipmentId: w.equipment.ammo, quantity: 5, assigneeName: 'Sgt. Dash Board', assigneeServiceNo: 'DSH-0001', assignedAt: daysAgo(1),
  });
  expect(asg.status).toBe(201);

  from = daysAgo(10);
  to = new Date().toISOString(); // after the transfers completed
});

/** Defaults to the scenario period; `qs` may override from/to. */
const summary = async (who, qs = '') => {
  const params = new URLSearchParams({ from, to });
  for (const [k, v] of new URLSearchParams(qs)) params.set(k, v);
  const res = await who.get(`/api/dashboard/summary?${params}`);
  expect(res.status).toBe(200);
  return res.body.data;
};

describe('GET /api/dashboard/summary', () => {
  it('computes every figure for one base from the ledger', async () => {
    const s = await summary(admin, `baseId=${w.bases.B1}`);
    expect(s).toMatchObject({
      openingBalance: 160,
      purchases: 57,
      transferIn: 20,
      transferOut: 30,
      netMovement: 47,
      assigned: 5,
      expended: 10,
      adjustments: 0,
      closingBalance: 197,
    });
    expect(s.period).toEqual({ from, to });
  });

  it('closing balance equals the live on-hand stock (assignments do not reduce it)', async () => {
    const s = await summary(admin, `baseId=${w.bases.B1}`);
    const [ammo, kit] = [await w.balance('B1', 'ammo'), await w.balance('B1', 'kit')];
    expect(s.closingBalance).toBe(ammo.onHand + kit.onHand);
    expect(ammo.assigned).toBe(5);
  });

  it('a scoped user gets their own base without naming it; naming another base is refused', async () => {
    const own = await summary(cmdr1);
    expect(own).toMatchObject({ openingBalance: 160, closingBalance: 197, filters: { baseId: w.bases.B1 } });
    expect(await summary(log1)).toEqual(own);
    expectError(await cmdr1.get(`/api/dashboard/summary?baseId=${w.bases.B2}`), 403, 'BASE_ACCESS_DENIED');
  });

  it('filters by equipment and by equipment type', async () => {
    expect(await summary(admin, `baseId=${w.bases.B1}&equipmentId=${w.equipment.ammo}`)).toMatchObject({
      openingBalance: 160, purchases: 50, transferIn: 20, transferOut: 30, netMovement: 40, expended: 10, assigned: 5, closingBalance: 190,
    });
    expect(await summary(admin, `baseId=${w.bases.B1}&equipmentTypeId=${w.types.other}`)).toMatchObject({
      openingBalance: 0, purchases: 7, transferIn: 0, transferOut: 0, netMovement: 7, expended: 0, assigned: 0, closingBalance: 7,
    });
  });

  it('opening balance comes only from transactions before the period', async () => {
    // Widen the period to include the opening stock and the first purchase.
    const wide = await summary(admin, `baseId=${w.bases.B1}&from=${daysAgo(50)}`);
    expect(wide).toMatchObject({ openingBalance: 0, adjustments: 100, purchases: 117, closingBalance: 197 });

    // Move the period start past the -5d purchases: they become part of the opening balance.
    const late = await summary(admin, `baseId=${w.bases.B1}&from=${daysAgo(3)}`);
    expect(late).toMatchObject({ openingBalance: 217, purchases: 0, closingBalance: 197 });
  });

  it('a period that ends before the transfers excludes them', async () => {
    const res = await admin.get(`/api/dashboard/summary?baseId=${w.bases.B1}&from=${from}&to=${daysAgo(3)}`);
    expect(res.body.data).toMatchObject({
      openingBalance: 160, purchases: 57, transferIn: 0, transferOut: 0, expended: 0, assigned: 0, closingBalance: 217,
    });
  });

  it('the counterparty base sees the mirror image', async () => {
    expect(await summary(admin, `baseId=${w.bases.B2}&equipmentId=${w.equipment.ammo}`)).toMatchObject({
      openingBalance: 500, transferIn: 30, transferOut: 20, netMovement: 10, closingBalance: 510,
    });
  });

  it('across all bases, transfers appear on both sides and cancel out in net movement', async () => {
    const all = await summary(admin, `equipmentId=${w.equipment.ammo}`);
    expect(all).toMatchObject({ transferIn: 50, transferOut: 50, purchases: 50, netMovement: 50, closingBalance: 700 });
  });

  it('defaults to the last 30 days', async () => {
    // [-30d, now]: the -40d opening stock is before it; the -20d purchase is inside it.
    const res = await cmdr1.get('/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ openingBalance: 100, purchases: 117, closingBalance: 197 });
  });

  it('rejects an inverted period and malformed dates (400)', async () => {
    expectError(await admin.get(`/api/dashboard/summary?from=${to}&to=${from}`), 400, 'VALIDATION_ERROR');
    expectError(await admin.get('/api/dashboard/summary?from=last-week'), 400, 'VALIDATION_ERROR');
    expectError(await admin.get('/api/dashboard/summary?unknown=1'), 400, 'VALIDATION_ERROR');
  });
});

describe('GET /api/dashboard/movement-breakdown', () => {
  it('returns purchases, transfer in/out and net movement, in total and per equipment', async () => {
    const res = await cmdr1.get(`/api/dashboard/movement-breakdown?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    const b = res.body.data;
    expect(b).toMatchObject({ purchases: 57, transferIn: 20, transferOut: 30, netMovement: 47 });
    expect(b.byEquipment.map((r) => [r.equipment.id, r.purchases, r.transferIn, r.transferOut, r.netMovement])).toEqual([
      [w.equipment.ammo, 50, 20, 30, 40],
      [w.equipment.kit, 7, 0, 0, 7],
    ]);
    expect(b.byEquipment[0].equipment.equipmentType).toMatchObject({ id: w.types.main });
  });

  it('agrees with the summary for the same filters', async () => {
    const qs = `baseId=${w.bases.B1}&equipmentId=${w.equipment.ammo}&from=${from}&to=${to}`;
    const [s, b] = await Promise.all([
      admin.get(`/api/dashboard/summary?${qs}`),
      admin.get(`/api/dashboard/movement-breakdown?${qs}`),
    ]);
    for (const key of ['purchases', 'transferIn', 'transferOut', 'netMovement']) {
      expect(b.body.data[key]).toBe(s.body.data[key]);
    }
  });
});
