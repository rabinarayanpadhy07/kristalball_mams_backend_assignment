import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireBaseAccess } from '../../middleware/baseAccess.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { idParams } from '../../utils/schemas.js';
import * as controller from './assignments.controller.js';
import { createAssignmentBody, listAssignmentsQuery, returnAssignmentBody } from './assignments.schemas.js';

export function assignmentsRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.ASSIGNMENT_READ));

  router.get('/', validate({ query: listAssignmentsQuery }), requireBaseAccess(), controller.list);
  router.get('/:id', validate({ params: idParams }), requireBaseAccess(), controller.get);
  router.post(
    '/',
    requirePermission(PERMISSIONS.ASSIGNMENT_CREATE),
    validate({ body: createAssignmentBody }),
    requireBaseAccess({ sources: ['body'] }),
    idempotent(),
    controller.create,
  );
  router.post(
    '/:id/return',
    requirePermission(PERMISSIONS.ASSIGNMENT_RETURN),
    validate({ params: idParams, body: returnAssignmentBody }),
    requireBaseAccess({ sources: [] }),
    idempotent(),
    controller.returnItems,
  );

  return router;
}
