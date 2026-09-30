import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireBaseAccess } from '../../middleware/baseAccess.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { idParams } from '../../utils/schemas.js';
import * as controller from './expenditures.controller.js';
import { createExpenditureBody, listExpendituresQuery } from './expenditures.schemas.js';

export function expendituresRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.EXPENDITURE_READ));

  router.get('/', validate({ query: listExpendituresQuery }), requireBaseAccess(), controller.list);
  router.get('/:id', validate({ params: idParams }), requireBaseAccess(), controller.get);
  router.post(
    '/',
    requirePermission(PERMISSIONS.EXPENDITURE_CREATE),
    validate({ body: createExpenditureBody }),
    requireBaseAccess({ sources: ['body'] }),
    idempotent(),
    controller.create,
  );

  return router;
}
