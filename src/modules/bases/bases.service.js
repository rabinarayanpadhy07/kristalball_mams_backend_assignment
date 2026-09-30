import { prisma } from '../../db/prisma.js';
import { notFound } from '../../utils/errors.js';

const select = { id: true, code: true, name: true, location: true, isActive: true, createdAt: true, updatedAt: true };

/** ADMIN: all bases (or the one named in the query). Others: only their own. */
export function listBases(scope) {
  return prisma.base.findMany({
    where: scope.baseId == null ? {} : { id: scope.baseId },
    select,
    orderBy: { code: 'asc' },
  });
}

/** `scope` has already been checked by requireBaseAccess() for this base id. */
export async function getBase(scope) {
  const base = await prisma.base.findUnique({ where: { id: scope.baseId }, select });
  if (!base) throw notFound('Base not found');
  return base;
}

/** Not base-scoped: any authenticated user may see which active bases exist (no details). */
export function listDirectory() {
  return prisma.base.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });
}
