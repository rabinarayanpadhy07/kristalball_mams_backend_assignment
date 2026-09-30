import { prisma } from '../../db/prisma.js';
import { baseWhere } from '../../rbac/scope.js';
import { notFound } from '../../utils/errors.js';
import { baseSummary, equipmentSummary, paginate } from '../../utils/query.js';

// Read side of the Inventory projection. All writes go through inventory.service.js.

export async function listBalances(scope, query) {
  const where = {
    ...baseWhere(scope),
    equipmentId: query.equipmentId,
    equipment: { equipmentTypeId: query.equipmentTypeId, trackingType: query.trackingType },
    ...(query.inStock ? { quantityOnHand: { gt: 0 } } : {}),
  };
  const { items, total } = await paginate(prisma.inventory, {
    where,
    query,
    include: { base: baseSummary, equipment: equipmentSummary },
    orderBy: [{ base: { code: 'asc' } }, { equipment: { code: 'asc' } }],
  });
  return { items: items.map(toBalance), total };
}

/** `scope.baseId` has been authorized by requireBaseAccess(); ADMIN may name a base that does not exist. */
export async function listBaseBalances(scope, query) {
  const base = await prisma.base.findUnique({ where: { id: scope.baseId }, select: { id: true } });
  if (!base) throw notFound('Base not found');
  return listBalances(scope, query);
}

function toBalance(row) {
  return {
    id: row.id,
    base: row.base,
    equipment: row.equipment,
    quantityOnHand: row.quantityOnHand,
    quantityAssigned: row.quantityAssigned,
    quantityAvailable: row.quantityOnHand - row.quantityAssigned,
    updatedAt: row.updatedAt,
  };
}
