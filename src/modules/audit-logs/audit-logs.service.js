import { prisma } from '../../db/prisma.js';
import { notFound } from '../../utils/errors.js';
import { baseSummary, dateRange, paginate } from '../../utils/query.js';

// Read-only by design: audit_logs is append-only (DB triggers block UPDATE/DELETE)
// and no write endpoint exists. Rows are written only by audit.service inside the
// transaction of the change they describe.

const include = {
  actor: { select: { id: true, fullName: true, email: true } },
  base: baseSummary,
};

export function listAuditLogs(query) {
  const where = {
    createdAt: dateRange(query.from, query.to),
    actorUserId: query.actorUserId,
    action: query.action,
    entityType: query.entityType,
    entityId: query.entityId,
    baseId: query.baseId,
  };
  return paginate(prisma.auditLog, {
    where,
    query,
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

export async function getAuditLog(auditLogId) {
  const entry = await prisma.auditLog.findUnique({ where: { id: auditLogId }, include });
  if (!entry) throw notFound('Audit record not found');
  return entry;
}

/** Distinct values for the filter controls. */
export async function getFacets() {
  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
  ]);
  return { actions: actions.map((a) => a.action), entityTypes: entityTypes.map((e) => e.entityType) };
}
