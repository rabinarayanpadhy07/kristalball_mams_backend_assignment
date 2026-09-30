import { z } from 'zod';
import { bodyId, historyFilters, id, isoDate, optionalText, quantity, validDateRange } from '../../utils/schemas.js';

const reason = z.enum(['TRAINING', 'OPERATION', 'MAINTENANCE', 'DAMAGED', 'LOST', 'OTHER']);

export const listExpendituresQuery = z
  .object({
    ...historyFilters,
    status: z.enum(['POSTED', 'VOIDED']).optional(),
    reason: reason.optional(),
    assignmentId: id.optional(),
    /** Assignee service number prefix or name, for stock expended while assigned. */
    personnel: z.string().trim().min(1).max(150).optional(),
  })
  .strict()
  .refine(...validDateRange);

export const createExpenditureBody = z
  .object({
    /** Required for ADMIN unless assignmentId is given; scoped roles may omit it. */
    baseId: bodyId.optional(),
    /** Required unless assignmentId is given (then it is taken from the assignment). */
    equipmentId: bodyId.optional(),
    /** Expend stock held by an assignee (reduces both on-hand and assigned). */
    assignmentId: bodyId.optional(),
    /** QUANTITY-tracked equipment. */
    quantity: quantity.optional(),
    /** SERIALIZED equipment not drawn from an assignment: the unit consumed. */
    assetId: bodyId.optional(),
    reason,
    expendedAt: isoDate.optional(),
    notes: optionalText(5000),
  })
  .strict()
  .refine((b) => b.equipmentId !== undefined || b.assignmentId !== undefined, {
    message: 'equipmentId is required unless assignmentId is given',
    path: ['equipmentId'],
  });
