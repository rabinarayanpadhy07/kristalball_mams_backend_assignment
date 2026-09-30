import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ROLES } from '../../rbac/permissions.js';
import { pagination } from '../../utils/schemas.js';
import * as controller from './users.controller.js';

// Read-only for now; user management (create/update/deactivate) comes with the admin module.
export function usersRouter() {
  const router = Router();
  router.use(requireAuth(), requireRole(ROLES.ADMIN));

  router.get('/', validate({ query: z.object(pagination).strict() }), controller.list);

  return router;
}
