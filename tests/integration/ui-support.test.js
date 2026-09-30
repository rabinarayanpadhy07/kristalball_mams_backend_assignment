import { beforeAll, describe, expect, it } from 'vitest';
import { expectError } from '../helpers.js';
import { createWorld } from '../world.js';

/** Endpoints added for the web client: directory, assets, dashboard feeds, transfer filters, audit logs. */
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d) => new Date(Date.now() - d * DAY).toISOString();

let w;
let admin;
let cmdr1;
let log1;
let rifles;
let transferId;

beforeAll(async () => {
  w = await createWorld('UIS');
  [admin, cmdr1, log1] = await Promise.all(['admin', 'cmdr1', 'log1'].map((k) => w.as(k)));
  await w.stock('B1', 'ammo', 100, daysAgo(20));
  rifles = await w.stock('B1', 'rifle', 3, daysAgo(20));
  await admin.post('/api/purchases', { baseId: w.bases.B1, equipmentId: w.equipment.ammo, quantity: 40, purchasedAt: daysAgo(3) });
  const created = await log1.post('/api/transfers', { destinationBaseId: w.bases.B2, equipmentId: w.equipment.rifle, assetIds: rifles.slice(0, 2) });
  transferId = created.body.data.id;
  expect((await cmdr1.post(`/api/transfers/${transferId}/complete`)).status).toBe(200);
  await cmdr1.post('/api/expenditures', { equipmentId: w.equipment.ammo, quantity: 15, reason: 'TRAINING', expendedAt: daysAgo(1) });
});

describe('GET /api/bases/directory', () => {
  it('lists every active base (minimal fields) even for scoped users', async () => {
    const res = await log1.get('/api/bases/directory');
    expect(res.status).toBe(200);
    const ids = res.body.data.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([w.bases.B1, w.bases.B2, w.bases.B3]));
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'name']);
  });
});

describe('GET /api/assets', () => {
  it('lists serialized units in scope, filtered by status and equipment', async () => {
    const res = await cmdr1.get(`/api/assets?equipmentId=${w.equipment.rifle}&status=AVAILABLE`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.id)).toEqual([rifles[2]]);
    expectError(await cmdr1.get(`/api/assets?baseId=${w.bases.B2}`), 403, 'BASE_ACCESS_DENIED');
    const atB2 = await admin.get(`/api/assets?baseId=${w.bases.B2}&equipmentId=${w.equipment.rifle}`);
    expect(atB2.body.meta.total).toBe(2);
  });
});

describe('GET /api/transfers — source/destination filters and history', () => {
  it('filters by source and destination within scope', async () => {
    expect((await cmdr1.get(`/api/transfers?sourceBaseId=${w.bases.B1}`)).body.meta.total).toBe(1);
    expect((await cmdr1.get(`/api/transfers?destinationBaseId=${w.bases.B1}`)).body.meta.total).toBe(0);
    // A filter can never widen the scope: B3 is invisible to cmdr1 either way.
    expect((await cmdr1.get(`/api/transfers?sourceBaseId=${w.bases.B3}`)).body.meta.total).toBe(0);
  });

  it('detail includes the ledger movements', async () => {
    const res = await cmdr1.get(`/api/transfers/${transferId}`);
    expect(res.body.data.movements).toHaveLength(4);
    expect(res.body.data.movements.map((m) => m.type).sort()).toEqual(['TRANSFER_IN', 'TRANSFER_IN', 'TRANSFER_OUT', 'TRANSFER_OUT']);
  });
});

describe('dashboard feeds', () => {
  const qs = () => `baseId=${w.bases.B1}&from=${daysAgo(10)}&to=${new Date().toISOString()}`;

  it('trends: continuous daily buckets that sum to the summary', async () => {
    const [trends, summary] = await Promise.all([admin.get(`/api/dashboard/trends?${qs()}`), admin.get(`/api/dashboard/summary?${qs()}`)]);
    const { granularity, buckets } = trends.body.data;
    expect(granularity).toBe('day');
    expect(buckets.length).toBeGreaterThanOrEqual(10);
    const total = (k) => buckets.reduce((s, b) => s + b[k], 0);
    expect(total('purchases')).toBe(summary.body.data.purchases);
    expect(total('transferOut')).toBe(summary.body.data.transferOut);
    expect(total('expended')).toBe(summary.body.data.expended);
    expect(total('inbound') - total('outbound')).toBe(summary.body.data.netMovement - summary.body.data.expended);
  });

  it('trends switch to weekly and monthly buckets for longer periods', async () => {
    const weekly = await admin.get(`/api/dashboard/trends?baseId=${w.bases.B1}&from=${daysAgo(120)}`);
    expect(weekly.body.data.granularity).toBe('week');
    const monthly = await admin.get(`/api/dashboard/trends?baseId=${w.bases.B1}&from=${daysAgo(400)}`);
    expect(monthly.body.data.granularity).toBe('month');
  });

  it('distribution: stock on hand by equipment type, matching live inventory', async () => {
    const res = await cmdr1.get('/api/dashboard/distribution');
    const main = res.body.data.byType.find((t) => t.equipmentType.id === w.types.main);
    const ammo = main.items.find((i) => i.equipment.id === w.equipment.ammo);
    const rifle = main.items.find((i) => i.equipment.id === w.equipment.rifle);
    expect(ammo.quantity).toBe((await w.balance('B1', 'ammo')).onHand);
    expect(rifle.quantity).toBe(1);
  });

  it('activity: newest first, one entry per document (serialized transfer grouped)', async () => {
    const res = await cmdr1.get(`/api/dashboard/activity?from=${daysAgo(10)}`);
    const entries = res.body.data;
    expect(entries.map((e) => e.type)).toEqual(['TRANSFER_OUT', 'EXPENDITURE', 'PURCHASE']);
    expect(entries[0]).toMatchObject({ quantity: -2, document: { type: 'transfer', id: transferId } });
  });
});

describe('GET /api/audit-logs', () => {
  it('is admin-only', async () => {
    expectError(await cmdr1.get('/api/audit-logs'), 403, 'FORBIDDEN');
    expectError(await log1.get('/api/audit-logs'), 403, 'FORBIDDEN');
  });

  it('filters by actor, action, entity type and base, with pagination', async () => {
    const res = await admin.get(`/api/audit-logs?actorUserId=${w.users.cmdr1.id}&action=TRANSFER_COMPLETED&entityType=Transfer&baseId=${w.bases.B1}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ entityId: String(transferId), actor: { id: w.users.cmdr1.id }, base: { id: w.bases.B1 } });
  });

  it('detail carries before/after; facets list known actions and entity types', async () => {
    const list = await admin.get(`/api/audit-logs?action=TRANSFER_COMPLETED&entityId=${transferId}`);
    const detail = await admin.get(`/api/audit-logs/${list.body.data[0].id}`);
    expect(detail.body.data.before).toMatchObject({ status: 'PENDING' });
    expect(detail.body.data.after).toMatchObject({ status: 'COMPLETED' });

    const facets = await admin.get('/api/audit-logs/facets');
    expect(facets.body.data.actions).toEqual(expect.arrayContaining(['TRANSFER_COMPLETED', 'PURCHASE_CREATED']));
    expect(facets.body.data.entityTypes).toEqual(expect.arrayContaining(['Transfer', 'Purchase']));
  });

  it('offers no way to change or delete an entry', async () => {
    const list = await admin.get('/api/audit-logs?pageSize=1');
    const id = list.body.data[0].id;
    for (const method of ['post', 'patch', 'delete']) {
      const { api, bearer } = await import('../helpers.js');
      const res = await api()[method](`/api/audit-logs/${id}`).set(bearer(admin.token));
      expect(res.status).toBe(404);
    }
  });
});
