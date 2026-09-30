import { prisma } from '../../db/prisma.js';
import { notFound, unprocessable } from '../../utils/errors.js';
import { paginate } from '../../utils/query.js';
import { withTransaction } from '../../utils/transaction.js';
import { recordAudit } from '../audit/audit.service.js';

// Catalog data is not base-scoped: every role may read it; only ADMIN may change it.

const include = { equipmentType: { select: { id: true, code: true, name: true } } };

export function listEquipment(query) {
  const where = {
    equipmentTypeId: query.equipmentTypeId,
    trackingType: query.trackingType,
    isActive: query.isActive,
    ...(query.q ? { OR: [{ code: { contains: query.q } }, { name: { contains: query.q } }] } : {}),
  };
  return paginate(prisma.equipment, { where, query, include, orderBy: [{ code: 'asc' }] });
}

export async function getEquipment(equipmentId) {
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId }, include });
  if (!equipment) throw notFound('Equipment not found');
  return equipment;
}

export function listEquipmentTypes(query) {
  return prisma.equipmentType.findMany({
    where: { isActive: query.isActive },
    orderBy: { code: 'asc' },
    include: { _count: { select: { equipment: true } } },
  });
}

/** Duplicate code or (type, name) → 409 DUPLICATE via the unique indexes. */
export function createEquipment(actor, input, context) {
  return withTransaction(async (tx) => {
    const type = await tx.equipmentType.findUnique({ where: { id: input.equipmentTypeId } });
    if (!type) throw unprocessable('EQUIPMENT_TYPE_NOT_FOUND', 'Equipment type not found');
    if (!type.isActive) throw unprocessable('EQUIPMENT_TYPE_INACTIVE', `Equipment type ${type.code} is inactive`);

    const equipment = await tx.equipment.create({ data: input, include });
    await recordAudit(tx, {
      actor,
      action: 'EQUIPMENT_CREATED',
      entityType: 'Equipment',
      entityId: equipment.id,
      after: equipment,
      context,
    });
    return equipment;
  });
}
