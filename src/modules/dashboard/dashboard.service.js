import { prisma } from '../../db/prisma.js';
import { Prisma } from '../../generated/prisma/client.ts';
import { baseSummary, equipmentSummary } from '../../utils/query.js';

/**
 * Dashboard figures, computed on the server from the append-only ledger
 * (`inventory_movements`) for a scope of bases × equipment and a period [from, to]:
 *
 *   openingBalance = Σ quantity_delta           where occurred_at <  from
 *   purchases      = Σ PURCHASE deltas          where from ≤ occurred_at ≤ to
 *   transferIn     = Σ TRANSFER_IN deltas       (same period)
 *   transferOut    = Σ |TRANSFER_OUT deltas|    (same period)
 *   expended       = Σ |EXPENDITURE deltas|     (same period)
 *   adjustments    = Σ ADJUSTMENT deltas        (admin corrections / opening stock; signed)
 *   netMovement    = purchases + transferIn − transferOut
 *   closingBalance = opening + purchases + transferIn − transferOut − expended + adjustments
 *                  ≡ Σ quantity_delta where occurred_at ≤ to   (invariant, tested)
 *   assigned       = quantity issued by assignments dated in the period (custody, not
 *                    consumption: it does not reduce the closing balance)
 *
 * Voided documents write same-type reversal rows, so they net out inside their type.
 * Transfers between two bases that are both in scope appear as both in and out.
 *
 * Opening and period figures come from ONE statement (one consistent snapshot, one
 * index range scan). The ledger's covering indexes make it index-only for every
 * filter shape: base+equipment, base, equipment, or all bases.
 */
export async function getSummary(scope, query) {
  const filters = { baseId: scope.baseId, equipmentId: query.equipmentId, equipmentTypeId: query.equipmentTypeId };
  const from = sqlDateTime(query.from);
  const to = sqlDateTime(query.to);

  const [[ledger], [assignments]] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN m.occurred_at < ${from} THEN m.quantity_delta ELSE 0 END), 0) AS openingBalance,
        COALESCE(SUM(CASE WHEN m.occurred_at >= ${from} AND m.type = 'PURCHASE' THEN m.quantity_delta ELSE 0 END), 0) AS purchases,
        COALESCE(SUM(CASE WHEN m.occurred_at >= ${from} AND m.type = 'TRANSFER_IN' THEN m.quantity_delta ELSE 0 END), 0) AS transferIn,
        COALESCE(SUM(CASE WHEN m.occurred_at >= ${from} AND m.type = 'TRANSFER_OUT' THEN -m.quantity_delta ELSE 0 END), 0) AS transferOut,
        COALESCE(SUM(CASE WHEN m.occurred_at >= ${from} AND m.type = 'EXPENDITURE' THEN -m.quantity_delta ELSE 0 END), 0) AS expended,
        COALESCE(SUM(CASE WHEN m.occurred_at >= ${from} AND m.type = 'ADJUSTMENT' THEN m.quantity_delta ELSE 0 END), 0) AS adjustments
      FROM inventory_movements m
      WHERE m.occurred_at <= ${to} ${scopeFilter('m', filters)}`,
    prisma.$queryRaw`
      SELECT COALESCE(SUM(a.quantity), 0) AS assigned
      FROM assignments a
      WHERE a.assigned_at BETWEEN ${from} AND ${to} ${scopeFilter('a', filters)}`,
  ]);

  const n = mapNumbers(ledger);
  const netMovement = n.purchases + n.transferIn - n.transferOut;
  return {
    openingBalance: n.openingBalance,
    purchases: n.purchases,
    transferIn: n.transferIn,
    transferOut: n.transferOut,
    netMovement,
    assigned: Number(assignments.assigned),
    expended: n.expended,
    adjustments: n.adjustments,
    closingBalance: n.openingBalance + netMovement - n.expended + n.adjustments,
    period: { from: query.from, to: query.to },
    filters: { ...filters, baseId: filters.baseId ?? null },
  };
}

/** The Net Movement drill-down: totals plus one row per equipment item that moved. */
export async function getMovementBreakdown(scope, query) {
  const filters = { baseId: scope.baseId, equipmentId: query.equipmentId, equipmentTypeId: query.equipmentTypeId };

  const rows = await prisma.$queryRaw`
    SELECT
      m.equipment_id AS equipmentId,
      SUM(CASE WHEN m.type = 'PURCHASE' THEN m.quantity_delta ELSE 0 END) AS purchases,
      SUM(CASE WHEN m.type = 'TRANSFER_IN' THEN m.quantity_delta ELSE 0 END) AS transferIn,
      SUM(CASE WHEN m.type = 'TRANSFER_OUT' THEN -m.quantity_delta ELSE 0 END) AS transferOut
    FROM inventory_movements m
    WHERE m.occurred_at BETWEEN ${sqlDateTime(query.from)} AND ${sqlDateTime(query.to)}
      AND m.type IN ('PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT')
      ${scopeFilter('m', filters)}
    GROUP BY m.equipment_id
    HAVING purchases <> 0 OR transferIn <> 0 OR transferOut <> 0`;

  const equipment = await prisma.equipment.findMany({
    where: { id: { in: rows.map((r) => Number(r.equipmentId)) } },
    select: equipmentSummary.select,
  });
  const byId = new Map(equipment.map((e) => [e.id, e]));

  const byEquipment = rows
    .map((r) => {
      const { purchases, transferIn, transferOut } = mapNumbers(r);
      return {
        equipment: byId.get(Number(r.equipmentId)),
        purchases,
        transferIn,
        transferOut,
        netMovement: purchases + transferIn - transferOut,
      };
    })
    .sort((a, b) => a.equipment.code.localeCompare(b.equipment.code));

  const total = (key) => byEquipment.reduce((sum, row) => sum + row[key], 0);
  return {
    purchases: total('purchases'),
    transferIn: total('transferIn'),
    transferOut: total('transferOut'),
    netMovement: total('netMovement'),
    byEquipment,
    period: { from: query.from, to: query.to },
    filters: { ...filters, baseId: filters.baseId ?? null },
  };
}

/** `alias` is a fixed table alias from this module, never client input. */
function scopeFilter(alias, { baseId, equipmentId, equipmentTypeId }) {
  const col = (name) => Prisma.raw(`${alias}.${name}`);
  const parts = [];
  if (baseId != null) parts.push(Prisma.sql`AND ${col('base_id')} = ${baseId}`);
  if (equipmentId != null) parts.push(Prisma.sql`AND ${col('equipment_id')} = ${equipmentId}`);
  if (equipmentTypeId != null) {
    parts.push(Prisma.sql`AND ${col('equipment_id')} IN (SELECT e.id FROM equipment e WHERE e.equipment_type_id = ${equipmentTypeId})`);
  }
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
}

/** DATETIME(3) columns hold UTC; pass an explicit UTC literal so no driver/zone conversion applies. */
function sqlDateTime(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/** SUM() comes back as DECIMAL (string/BigInt depending on driver). */
function mapNumbers(row) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart and activity feeds (same filters and scope as the summary)
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

// Fixed SQL expressions keyed by granularity; never built from client input.
const BUCKET_SQL = {
  day: "DATE_FORMAT(m.occurred_at, '%Y-%m-%d')",
  week: "DATE_FORMAT(DATE_SUB(DATE(m.occurred_at), INTERVAL WEEKDAY(m.occurred_at) DAY), '%Y-%m-%d')",
  month: "DATE_FORMAT(m.occurred_at, '%Y-%m-01')",
};

/** Up to ~45 days by day, ~6 months by week (Monday start), longer by month. UTC buckets. */
export function granularityFor(from, to) {
  const days = (to - from) / DAY_MS;
  if (days <= 45) return 'day';
  if (days <= 190) return 'week';
  return 'month';
}

/**
 * Movement per time bucket for the Inventory Movement chart:
 * inbound = purchases + transferIn, outbound = transferOut + expended.
 * Empty buckets are filled with zeros so the series is continuous.
 */
export async function getTrends(scope, query) {
  const filters = { baseId: scope.baseId, equipmentId: query.equipmentId, equipmentTypeId: query.equipmentTypeId };
  const granularity = granularityFor(query.from, query.to);
  const bucket = Prisma.raw(BUCKET_SQL[granularity]);

  const rows = await prisma.$queryRaw`
    SELECT
      ${bucket} AS bucket,
      SUM(CASE WHEN m.type = 'PURCHASE' THEN m.quantity_delta ELSE 0 END) AS purchases,
      SUM(CASE WHEN m.type = 'TRANSFER_IN' THEN m.quantity_delta ELSE 0 END) AS transferIn,
      SUM(CASE WHEN m.type = 'TRANSFER_OUT' THEN -m.quantity_delta ELSE 0 END) AS transferOut,
      SUM(CASE WHEN m.type = 'EXPENDITURE' THEN -m.quantity_delta ELSE 0 END) AS expended
    FROM inventory_movements m
    WHERE m.occurred_at BETWEEN ${sqlDateTime(query.from)} AND ${sqlDateTime(query.to)}
      AND m.type IN ('PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'EXPENDITURE')
      ${scopeFilter('m', filters)}
    GROUP BY bucket
    ORDER BY bucket`;

  const byBucket = new Map(rows.map(({ bucket: key, ...sums }) => [String(key), mapNumbers(sums)]));
  const buckets = bucketStarts(query.from, query.to, granularity).map((start) => {
    const r = byBucket.get(start) ?? { purchases: 0, transferIn: 0, transferOut: 0, expended: 0 };
    const inbound = r.purchases + r.transferIn;
    const outbound = r.transferOut + r.expended;
    return { start, ...r, inbound, outbound, net: inbound - outbound };
  });
  return { granularity, buckets, period: { from: query.from, to: query.to } };
}

function bucketStarts(from, to, granularity) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (granularity === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (granularity === 'month') d.setUTCDate(1);
  const starts = [];
  while (d <= to && starts.length < 400) {
    starts.push(d.toISOString().slice(0, 10));
    if (granularity === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (granularity === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return starts;
}

/**
 * Stock on hand at the end of the period (Σ ledger up to `to`), grouped by equipment
 * type with its items. Units of measure differ between items, so each item carries
 * its unit and a type total is only a count of mixed units.
 */
export async function getDistribution(scope, query) {
  const filters = { baseId: scope.baseId, equipmentId: query.equipmentId, equipmentTypeId: query.equipmentTypeId };
  const rows = await prisma.$queryRaw`
    SELECT m.equipment_id AS equipmentId, SUM(m.quantity_delta) AS quantity
    FROM inventory_movements m
    WHERE m.occurred_at <= ${sqlDateTime(query.to)} ${scopeFilter('m', filters)}
    GROUP BY m.equipment_id
    HAVING quantity <> 0`;

  const equipment = await prisma.equipment.findMany({
    where: { id: { in: rows.map((r) => Number(r.equipmentId)) } },
    select: equipmentSummary.select,
  });
  const byId = new Map(equipment.map((e) => [e.id, e]));

  const types = new Map();
  for (const r of rows) {
    const item = byId.get(Number(r.equipmentId));
    const quantity = Number(r.quantity);
    const type = types.get(item.equipmentType.id) ?? { equipmentType: item.equipmentType, quantity: 0, items: [] };
    type.quantity += quantity;
    type.items.push({ equipment: item, quantity });
    types.set(item.equipmentType.id, type);
  }
  const byType = [...types.values()]
    .map((t) => ({ ...t, items: t.items.sort((a, b) => b.quantity - a.quantity) }))
    .sort((a, b) => b.quantity - a.quantity);
  return { asOf: query.to, byType };
}

const DOCUMENTS = [
  ['purchase', 'purchaseId'],
  ['transfer', 'transferId'],
  ['expenditure', 'expenditureId'],
  ['adjustment', 'adjustmentId'],
];

/**
 * Latest stock movements in the period, one entry per document and base: a serialized
 * transfer of 10 rifles is one entry, not 10 ledger rows.
 */
export async function getActivity(scope, query, limit = 10) {
  const rows = await prisma.inventoryMovement.findMany({
    where: {
      ...(scope.baseId != null ? { baseId: scope.baseId } : {}),
      equipmentId: query.equipmentId,
      ...(query.equipmentTypeId ? { equipment: { equipmentTypeId: query.equipmentTypeId } } : {}),
      occurredAt: { gte: query.from, lte: query.to },
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: 500,
    include: {
      base: baseSummary,
      equipment: { select: { id: true, code: true, name: true, unitOfMeasure: true } },
      createdBy: { select: { id: true, fullName: true } },
      purchase: { select: { referenceNo: true } },
      transfer: { select: { referenceNo: true } },
      expenditure: { select: { referenceNo: true } },
      adjustment: { select: { referenceNo: true } },
    },
  });

  const entries = new Map();
  for (const row of rows) {
    const [documentType, key] = DOCUMENTS.find(([, k]) => row[k] != null);
    const id = `${row.type}:${row.baseId}:${documentType}:${row[key]}:${row.isReversal ? 1 : 0}`;
    const entry = entries.get(id);
    if (entry) {
      entry.quantity += row.quantityDelta;
    } else if (entries.size < limit) {
      entries.set(id, {
        id,
        type: row.type,
        isReversal: row.isReversal,
        quantity: row.quantityDelta,
        occurredAt: row.occurredAt,
        base: row.base,
        equipment: row.equipment,
        createdBy: row.createdBy,
        document: { type: documentType, id: row[key], referenceNo: row[documentType]?.referenceNo ?? null },
      });
    }
  }
  return [...entries.values()];
}
