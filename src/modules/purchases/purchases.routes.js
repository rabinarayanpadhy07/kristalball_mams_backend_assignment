import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireBaseAccess } from '../../middleware/baseAccess.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { idParams } from '../../utils/schemas.js';
import * as controller from './purchases.controller.js';
import { createPurchaseBody, listPurchasesQuery } from './purchases.schemas.js';

export function purchasesRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.PURCHASE_READ));

  router.get('/', validate({ query: listPurchasesQuery }), requireBaseAccess(), controller.list);
  router.get('/:id', validate({ params: idParams }), requireBaseAccess(), controller.get);
  router.post(
    '/',
    requirePermission(PERMISSIONS.PURCHASE_CREATE),
    validate({ body: createPurchaseBody }),
    requireBaseAccess({ sources: ['body'] }),
    idempotent(),
    controller.create,
  );

  return router;
}
