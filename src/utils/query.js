/** Prisma helpers shared by the list endpoints. `undefined` filters are ignored by Prisma. */

export function dateRange(from, to) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

export function pageArgs({ page, pageSize }) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** Common equipment filters for documents with an `equipmentId` column. */
export function equipmentWhere({ equipmentId, equipmentTypeId }) {
  return {
    ...(equipmentId ? { equipmentId } : {}),
    ...(equipmentTypeId ? { equipment: { equipmentTypeId } } : {}),
  };
}

/** Runs the page query and the count together. */
export async function paginate(delegate, { where, query, ...args }) {
  const [items, total] = await Promise.all([
    delegate.findMany({ where, ...pageArgs(query), ...args }),
    delegate.count({ where }),
  ]);
  return { items, total };
}

export const baseSummary = { select: { id: true, code: true, name: true } };
export const userSummary = { select: { id: true, fullName: true } };
export const equipmentSummary = {
  select: {
    id: true,
    code: true,
    name: true,
    trackingType: true,
    unitOfMeasure: true,
    equipmentType: { select: { id: true, code: true, name: true } },
  },
};
