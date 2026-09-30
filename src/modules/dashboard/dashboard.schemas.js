import { z } from 'zod';
import { id, isoDate, isoDateEnd } from '../../utils/schemas.js';

const DEFAULT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** Period defaults to the 30 days up to now. `to` is inclusive; a bare date means end of that day (UTC). */
export const dashboardQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDateEnd.optional(),
    // Validated for shape here; whether the caller may use it is decided by requireBaseAccess().
    baseId: id.optional(),
    equipmentTypeId: id.optional(),
    equipmentId: id.optional(),
  })
  .strict()
  .transform((q) => {
    const to = q.to ?? new Date();
    return { ...q, to, from: q.from ?? new Date(to.getTime() - DEFAULT_PERIOD_MS) };
  })
  .refine((q) => q.from <= q.to, { message: '`from` must be before `to`', path: ['from'] });
