import { prisma } from '../../db/prisma.js';
import { baseWhere } from '../../rbac/scope.js';
import { baseSummary, paginate } from '../../utils/query.js';

export function listAssets(scope, query) {
  return paginate(prisma.asset, {
    where: {
      ...baseWhere(scope, 'currentBaseId'),
      equipmentId: query.equipmentId,
      status: query.status,
      ...(query.q ? { serialNumber: { startsWith: query.q } } : {}),
    },
    query,
    select: { id: true, serialNumber: true, status: true, equipmentId: true, currentBase: baseSummary },
    orderBy: [{ serialNumber: 'asc' }],
  });
}
