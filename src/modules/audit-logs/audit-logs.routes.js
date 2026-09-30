import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { id, idParams, isoDate, isoDateEnd, pagination, validDateRange } from '../../utils/schemas.js';
import * as controller from './audit-logs.controller.js';

const listAuditLogsQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDateEnd.optional(),
    actorUserId: id.optional(),
    action: z.string().trim().min(1).max(64).optional(),
    entityType: z.string().trim().min(1).max(64).optional(),
    entityId: z.string().trim().min(1).max(64).optional(),
    baseId: id.optional(),
    ...pagination,
  })
  .strict()
  .refine(...validDateRange);

/** ADMIN only (audit:read). GET routes only: the audit trail cannot be edited or deleted. */
export function auditLogsRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.AUDIT_READ));

  router.get('/', validate({ query: listAuditLogsQuery }), controller.list);
  router.get('/facets', controller.facets);
  router.get('/:id', validate({ params: idParams }), controller.get);

  return router;
}
