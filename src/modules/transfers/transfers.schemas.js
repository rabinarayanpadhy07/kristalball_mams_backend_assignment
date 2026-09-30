import { z } from 'zod';
import { bodyId, historyFilters, id, optionalText, quantity, validDateRange } from '../../utils/schemas.js';

export const listTransfersQuery = z
  .object({
    ...historyFilters,
    status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']).optional(),
    /** Relative to the scoped base: `out` = leaving it, `in` = arriving at it. Ignored for an all-bases view. */
    direction: z.enum(['in', 'out', 'all']).default('all'),
    /** Narrow within what the caller can already see (they never widen the base scope). */
    sourceBaseId: id.optional(),
    destinationBaseId: id.optional(),
  })
  .strict()
  .refine(...validDateRange);

export const createTransferBody = z
  .object({
    /** Required for ADMIN; scoped roles may omit it (their own base is used) or must name their own. */
    sourceBaseId: bodyId.optional(),
    destinationBaseId: bodyId,
    equipmentId: bodyId,
    /** QUANTITY-tracked equipment. For SERIALIZED equipment it may be sent, but must equal assetIds.length. */
    quantity: quantity.optional(),
    /** SERIALIZED equipment: the exact units to send. */
    assetIds: z.array(bodyId).min(1).max(500).optional(),
    notes: optionalText(5000),
  })
  .strict()
  .refine((b) => b.quantity !== undefined || b.assetIds !== undefined, {
    message: 'quantity is required (or assetIds for serialized equipment)',
    path: ['quantity'],
  })
  .refine((b) => b.sourceBaseId === undefined || b.sourceBaseId !== b.destinationBaseId, {
    message: 'Source and destination base must differ',
    path: ['destinationBaseId'],
  });

/** Completion takes no input: who and when come from the server. */
export const completeTransferBody = z.object({}).strict();

export const cancelTransferBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
