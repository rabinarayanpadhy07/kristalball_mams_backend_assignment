import { z } from 'zod';
import { bodyId, historyFilters, isoDate, optionalText, quantity, validDateRange } from '../../utils/schemas.js';

// There is no personnel registry: an assignee is identified by service number and
// name, validated here for shape. Service numbers are normalized to upper case.
export const personnelName = z
  .string()
  .trim()
  .min(2)
  .max(150)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} .,'-]*$/u, "Must contain only letters, spaces and . , ' -");

export const serviceNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,49}$/, 'Must be 3–50 letters, digits or hyphens');

export const listAssignmentsQuery = z
  .object({
    ...historyFilters,
    status: z.enum(['ACTIVE', 'RETURNED', 'CLOSED']).optional(),
    /** Service number prefix or part of the assignee name. */
    personnel: z.string().trim().min(1).max(150).optional(),
  })
  .strict()
  .refine(...validDateRange);

export const createAssignmentBody = z
  .object({
    /** Required for ADMIN; scoped roles may omit it (their own base is used) or must name their own. */
    baseId: bodyId.optional(),
    equipmentId: bodyId,
    /** QUANTITY-tracked equipment. */
    quantity: quantity.optional(),
    /** SERIALIZED equipment: the unit being issued. */
    assetId: bodyId.optional(),
    assigneeName: personnelName,
    assigneeServiceNo: serviceNumber,
    assigneeUnit: optionalText(150),
    purpose: optionalText(255),
    assignedAt: isoDate.optional(),
    expectedReturnAt: isoDate.optional(),
    notes: optionalText(5000),
  })
  .strict()
  .refine((b) => b.quantity !== undefined || b.assetId !== undefined, {
    message: 'quantity is required (or assetId for serialized equipment)',
    path: ['quantity'],
  });

export const returnAssignmentBody = z
  .object({
    /** Required for QUANTITY items (partial returns allowed); a serialized unit is always returned whole. */
    quantity: quantity.optional(),
    condition: z.enum(['SERVICEABLE', 'UNSERVICEABLE']).default('SERVICEABLE'),
    returnedAt: isoDate.optional(),
    notes: optionalText(500),
  })
  .strict();
