import { prisma } from '../../db/prisma.js';
import { canAccessBase, transferBaseWhere } from '../../rbac/scope.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { baseSummary, dateRange, equipmentSummary, equipmentWhere, paginate, userSummary } from '../../utils/query.js';
import * as inventory from '../inventory/inventory.service.js';

const include = {
  sourceBase: baseSummary,
  destinationBase: baseSummary,
  equipment: equipmentSummary,
  createdBy: userSummary,
  completedBy: userSummary,
  cancelledBy: userSummary,
  assets: { select: { asset: { select: { id: true, serialNumber: true } } }, orderBy: { assetId: 'asc' } },
};

const detailInclude = {
  ...include,
  movements: {
    select: { id: true, type: true, quantityDelta: true, occurredAt: true, isReversal: true, base: baseSummary, asset: { select: { id: true, serialNumber: true } } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  },
};

const toTransfer = ({ assets, ...transfer }) => ({ ...transfer, assets: assets.map((a) => a.asset) });

export async function listTransfers(scope, query) {
  const where = {
    AND: [
      transferBaseWhere(scope, query.direction),
      query.sourceBaseId ? { sourceBaseId: query.sourceBaseId } : {},
      query.destinationBaseId ? { destinationBaseId: query.destinationBaseId } : {},
    ],
    ...equipmentWhere(query),
    status: query.status,
    createdAt: dateRange(query.from, query.to),
  };
  const { items, total } = await paginate(prisma.transfer, {
    where,
    query,
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return { items: items.map(toTransfer), total };
}

/** Visible to both ends. Out-of-scope ids are reported as not found, so they cannot be probed. */
export async function getTransfer(scope, transferId) {
  const transfer = await prisma.transfer.findFirst({ where: { id: transferId, ...transferBaseWhere(scope) }, include: detailInclude });
  if (!transfer) throw notFound('Transfer not found');
  return toTransfer(transfer);
}

/** The caller has already authorized `input.sourceBaseId` (requireBaseAccess). */
export async function createTransfer(actor, input, context) {
  const transfer = await inventory.createTransfer(actor, input, context);
  return getTransfer({ baseId: null }, transfer.id);
}

export async function completeTransfer(user, scope, transferId, context) {
  await authorizeSourceAction(user, scope, transferId, 'complete');
  await inventory.completeTransfer(user, { transferId }, context);
  return getTransfer({ baseId: null }, transferId);
}

export async function cancelTransfer(user, scope, transferId, reason, context) {
  await authorizeSourceAction(user, scope, transferId, 'cancel');
  await inventory.cancelTransfer(user, { transferId, reason }, context);
  return getTransfer({ baseId: null }, transferId);
}

/**
 * Only the source base (or ADMIN) may complete or cancel: no base can pull stock out
 * of another. The destination can see the transfer, so it gets 403, not 404.
 * Base ids on a transfer are immutable, so checking before the transaction is race-free.
 */
async function authorizeSourceAction(user, scope, transferId, action) {
  const transfer = await prisma.transfer.findFirst({
    where: { id: transferId, ...transferBaseWhere(scope) },
    select: { sourceBaseId: true },
  });
  if (!transfer) throw notFound('Transfer not found');
  if (!canAccessBase(user, transfer.sourceBaseId)) {
    throw forbidden('TRANSFER_SOURCE_ONLY', `Only the source base can ${action} this transfer`);
  }
}
