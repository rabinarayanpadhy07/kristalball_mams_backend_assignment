import { z } from 'zod';
import { bodyId, historyFilters, isoDate, optionalText, quantity, validDateRange } from '../../utils/schemas.js';

export const listPurchasesQuery = z
  .object({
    ...historyFilters,
    status: z.enum(['POSTED', 'VOIDED']).optional(),
  })
  .strict()
  .refine(...validDateRange);

const money = z
  .union([z.number().nonnegative().finite(), z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Must be a decimal amount')])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v))
  .refine((v) => /^\d{1,12}\.?\d{0,2}$/.test(v), 'Must be at most 12 digits with 2 decimals');

// .strict(): status, createdById, referenceNo etc. can never be set by the client.
export const createPurchaseBody = z
  .object({
    /** Required for ADMIN; scoped roles may omit it (their own base is used) or must name their own. */
    baseId: bodyId.optional(),
    equipmentId: bodyId,
    /** QUANTITY-tracked equipment. For SERIALIZED equipment it may be sent, but must equal serialNumbers.length. */
    quantity: quantity.optional(),
    /** SERIALIZED equipment: one entry per unit received. */
    serialNumbers: z.array(z.string().trim().min(1).max(100)).min(1).max(500).optional(),
    unitCost: money.optional(),
    supplierName: optionalText(191),
    purchaseOrderNo: optionalText(50),
    purchasedAt: isoDate.optional(),
    notes: optionalText(5000),
  })
  .strict()
  .refine((b) => b.quantity !== undefined || b.serialNumbers !== undefined, {
    message: 'quantity is required (or serialNumbers for serialized equipment)',
    path: ['quantity'],
  });
