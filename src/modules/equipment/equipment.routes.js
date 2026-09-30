import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { idParams } from '../../utils/schemas.js';
import * as controller from './equipment.controller.js';
import { createEquipmentBody, listEquipmentQuery, listEquipmentTypesQuery } from './equipment.schemas.js';

export function equipmentRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.EQUIPMENT_READ));

  router.get('/', validate({ query: listEquipmentQuery }), controller.list);
  router.get('/:id', validate({ params: idParams }), controller.get);
  router.post(
    '/',
    requirePermission(PERMISSIONS.EQUIPMENT_MANAGE),
    validate({ body: createEquipmentBody }),
    idempotent(),
    controller.create,
  );

  return router;
}

export function equipmentTypesRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.EQUIPMENT_READ));

  router.get('/', validate({ query: listEquipmentTypesQuery }), controller.listTypes);

  return router;
}
