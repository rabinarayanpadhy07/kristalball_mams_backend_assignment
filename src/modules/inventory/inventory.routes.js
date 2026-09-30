import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireBaseAccess } from '../../middleware/baseAccess.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { baseIdParams, id, pagination } from '../../utils/schemas.js';
import * as controller from './inventory.controller.js';

const filters = {
  equipmentId: id.optional(),
  equipmentTypeId: id.optional(),
  trackingType: z.enum(['SERIALIZED', 'QUANTITY']).optional(),
  /** true → only rows with stock on hand. */
  inStock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ...pagination,
};

export function inventoryRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.INVENTORY_READ));

  router.get(
    '/',
    validate({ query: z.object({ baseId: id.optional(), ...filters }).strict() }),
    requireBaseAccess(),
    controller.list,
  );
  router.get(
    '/:baseId',
    validate({ params: baseIdParams, query: z.object(filters).strict() }),
    requireBaseAccess({ sources: ['params'] }),
    controller.listForBase,
  );

  return router;
}
