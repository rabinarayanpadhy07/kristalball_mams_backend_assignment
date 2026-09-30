import { z } from 'zod';

const INT_MAX = 2_147_483_647;

/** Positive integer id from a path/query string ("12"); arrays and junk fail. */
export const id = z.coerce.number().int().positive().max(INT_MAX);

/** Positive integer id in a JSON body: must be a real number, not "12" or true. */
export const bodyId = z.number().int().positive().max(INT_MAX);

export const idParams = z.object({ id }).strict();
export const baseIdParams = z.object({ baseId: id }).strict();

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

/** Stock quantities: whole, strictly positive numbers. The sign is never taken from the client. */
export const quantity = z
  .number({ error: 'Must be a number' })
  .int('Must be a whole number')
  .positive('Must be greater than zero')
  .max(1_000_000_000, 'Must be at most 1,000,000,000');

export const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date()).transform((v) => new Date(v));

/** Upper bound of a range: a bare date ("2026-09-30") means the end of that day (UTC), inclusive. */
export const isoDateEnd = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .or(z.iso.date().transform((v) => new Date(`${v}T23:59:59.999Z`)));

export const optionalText = (max) => z.string().trim().min(1).max(max).optional();

/** Filters shared by every historical-records list endpoint. */
export const historyFilters = {
  // Validated for shape here; whether the caller may use it is decided by requireBaseAccess().
  baseId: id.optional(),
  equipmentId: id.optional(),
  equipmentTypeId: id.optional(),
  from: isoDate.optional(),
  to: isoDateEnd.optional(),
  ...pagination,
};

export const validDateRange = [
  (q) => !q.from || !q.to || q.from <= q.to,
  { message: '`from` must be before `to`', path: ['from'] },
];
