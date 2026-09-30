import { prisma } from '../../db/prisma.js';
import { baseWhere } from '../../rbac/scope.js';
import { notFound } from '../../utils/errors.js';
import { baseSummary, dateRange, equipmentSummary, equipmentWhere, paginate, userSummary } from '../../utils/query.js';
import { postPurchase } from '../inventory/inventory.service.js';

const include = {
  base: baseSummary,
  equipment: equipmentSummary,
  createdBy: userSummary,
  voidedBy: userSummary,
};

export function listPurchases(scope, query) {
  const where = {
    ...baseWhere(scope),
    ...equipmentWhere(query),
    status: query.status,
    purchasedAt: dateRange(query.from, query.to),
  };
  return paginate(prisma.purchase, {
    where,
    query,
    include,
    orderBy: [{ purchasedAt: 'desc' }, { id: 'desc' }],
  });
}

/** Out-of-scope records are reported as not found, so ids cannot be probed. */
export async function getPurchase(scope, purchaseId) {
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, ...baseWhere(scope) },
    include: { ...include, movements: { select: { id: true, assetId: true, quantityDelta: true, occurredAt: true } } },
  });
  if (!purchase) throw notFound('Purchase not found');
  return purchase;
}

/**
 * The caller has already authorized `input.baseId` (requireBaseAccess). The purchase,
 * its ledger rows, the Inventory increment and the audit row commit together inside
 * inventory.service; the response is re-read afterwards with its relations.
 */
export async function createPurchase(actor, input, context) {
  const purchase = await postPurchase(actor, input, context);
  return prisma.purchase.findUnique({ where: { id: purchase.id }, include });
}
