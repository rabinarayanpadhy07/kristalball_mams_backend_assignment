import { z } from 'zod';

// .strict(): unknown keys (e.g. a client-supplied "role" or "baseId") are rejected, not ignored.
export const loginBody = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email('Must be a valid email address').max(191)),
    password: z.string().min(1, 'Password is required').max(200),
  })
  .strict();

/** Refresh/logout take their credential from the httpOnly cookie only. */
export const emptyBody = z.object({}).strict();
