import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireBaseAccess } from '../../middleware/baseAccess.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { id, pagination } from '../../utils/schemas.js';
import * as controller from './assets.controller.js';

const listAssetsQuery = z
  .object({
    baseId: id.optional(),
    equipmentId: id.optional(),
    status: z.enum(['AVAILABLE', 'ASSIGNED', 'EXPENDED']).optional(),
    /** Serial number prefix. */
    q: z.string().trim().min(1).max(100).optional(),
    ...pagination,
  })
  .strict();

/** Serialized units, scoped to the bases the caller can see. Read-only. */
export function assetsRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.INVENTORY_READ));

  router.get('/', validate({ query: listAssetsQuery }), requireBaseAccess(), controller.list);

  return router;
}
