import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireBaseAccess } from '../../middleware/baseAccess.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { baseIdParams, id } from '../../utils/schemas.js';
import * as controller from './bases.controller.js';

export function basesRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.BASE_READ));

  // Every active base (id/code/name only), e.g. to choose a transfer destination.
  router.get('/directory', controller.directory);
  router.get('/', validate({ query: z.object({ baseId: id.optional() }).strict() }), requireBaseAccess(), controller.list);
  router.get('/:baseId', validate({ params: baseIdParams }), requireBaseAccess(), controller.get);

  return router;
}
