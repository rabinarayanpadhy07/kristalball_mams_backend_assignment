import { prisma } from '../../db/prisma.js';
import { baseWhere } from '../../rbac/scope.js';
import { notFound } from '../../utils/errors.js';
import { baseSummary, dateRange, equipmentSummary, equipmentWhere, paginate, userSummary } from '../../utils/query.js';
import * as inventory from '../inventory/inventory.service.js';

// An assignment is custody of stock that still exists: it moves quantity from
// "available" to "assigned" and never writes a ledger row or reduces on-hand.
// Consumption is an Expenditure (which may draw from an assignment).

const include = {
  base: baseSummary,
  equipment: equipmentSummary,
  asset: { select: { id: true, serialNumber: true } },
  createdBy: userSummary,
};

const detailInclude = {
  ...include,
  returns: { include: { receivedBy: userSummary }, orderBy: { returnedAt: 'asc' } },
  expenditures: {
    select: { id: true, referenceNo: true, quantity: true, reason: true, expendedAt: true, status: true },
    orderBy: { expendedAt: 'asc' },
  },
};

const toAssignment = (a) => ({ ...a, quantityOutstanding: a.quantity - a.quantityReturned - a.quantityExpended });

export function personnelWhere(personnel) {
  if (!personnel) return {};
  return { OR: [{ assigneeServiceNo: { startsWith: personnel } }, { assigneeName: { contains: personnel } }] };
}

export async function listAssignments(scope, query) {
  const where = {
    ...baseWhere(scope),
    ...equipmentWhere(query),
    ...personnelWhere(query.personnel),
    status: query.status,
    assignedAt: dateRange(query.from, query.to),
  };
  const { items, total } = await paginate(prisma.assignment, {
    where,
    query,
    include,
    orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
  });
  return { items: items.map(toAssignment), total };
}

/** Out-of-scope records are reported as not found, so ids cannot be probed. */
export async function getAssignment(scope, assignmentId) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, ...baseWhere(scope) },
    include: detailInclude,
  });
  if (!assignment) throw notFound('Assignment not found');
  return toAssignment(assignment);
}

/** The caller has already authorized `input.baseId` (requireBaseAccess). */
export async function createAssignment(actor, input, context) {
  const assignment = await inventory.createAssignment(actor, input, context);
  return getAssignment({ baseId: null }, assignment.id);
}

/** Records a (partial) return; the assignment's base is immutable, so the scope check is race-free. */
export async function returnAssignment(actor, scope, assignmentId, input, context) {
  await getAssignment(scope, assignmentId);
  const { assignmentReturn } = await inventory.returnAssignment(actor, { ...input, assignmentId }, context);
  return { assignment: await getAssignment({ baseId: null }, assignmentId), assignmentReturn };
}
