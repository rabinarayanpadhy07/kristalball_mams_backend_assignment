import { prisma } from '../../db/prisma.js';
import { baseWhere, targetBaseId } from '../../rbac/scope.js';
import { notFound, unprocessable } from '../../utils/errors.js';
import { baseSummary, dateRange, equipmentSummary, equipmentWhere, paginate, userSummary } from '../../utils/query.js';
import { personnelWhere } from '../assignments/assignments.service.js';
import * as inventory from '../inventory/inventory.service.js';

const include = {
  base: baseSummary,
  equipment: equipmentSummary,
  asset: { select: { id: true, serialNumber: true } },
  assignment: { select: { id: true, referenceNo: true, assigneeName: true, assigneeServiceNo: true } },
  createdBy: userSummary,
  voidedBy: userSummary,
};

export function listExpenditures(scope, query) {
  const where = {
    ...baseWhere(scope),
    ...equipmentWhere(query),
    status: query.status,
    reason: query.reason,
    assignmentId: query.assignmentId,
    ...(query.personnel ? { assignment: personnelWhere(query.personnel) } : {}),
    expendedAt: dateRange(query.from, query.to),
  };
  return paginate(prisma.expenditure, {
    where,
    query,
    include,
    orderBy: [{ expendedAt: 'desc' }, { id: 'desc' }],
  });
}

/** Out-of-scope records are reported as not found, so ids cannot be probed. */
export async function getExpenditure(scope, expenditureId) {
  const expenditure = await prisma.expenditure.findFirst({ where: { id: expenditureId, ...baseWhere(scope) }, include });
  if (!expenditure) throw notFound('Expenditure not found');
  return expenditure;
}

/**
 * Validates quantity and availability, decrements on-hand, and writes the expenditure,
 * its EXPENDITURE ledger row and the audit row in one transaction (inventory.service).
 * With `assignmentId`, the base comes from the assignment, which must be in scope.
 */
export async function createExpenditure(actor, scope, input, context) {
  let baseId;
  if (input.assignmentId !== undefined) {
    const assignment = await prisma.assignment.findFirst({
      where: { id: input.assignmentId, ...baseWhere(scope) },
      select: { baseId: true },
    });
    if (!assignment) throw unprocessable('ASSIGNMENT_NOT_FOUND', 'Assignment not found');
    baseId = assignment.baseId;
  } else {
    baseId = targetBaseId(scope);
  }
  const expenditure = await inventory.postExpenditure(actor, { ...input, baseId }, context);
  return getExpenditure({ baseId: null }, expenditure.id);
}
