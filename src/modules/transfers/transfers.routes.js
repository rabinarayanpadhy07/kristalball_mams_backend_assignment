import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireBaseAccess } from '../../middleware/baseAccess.js';
import { idempotent } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import { idParams } from '../../utils/schemas.js';
import * as controller from './transfers.controller.js';
import { cancelTransferBody, completeTransferBody, createTransferBody, listTransfersQuery } from './transfers.schemas.js';

export function transfersRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.TRANSFER_READ));

  router.get('/', validate({ query: listTransfersQuery }), requireBaseAccess(), controller.list);
  router.get('/:id', validate({ params: idParams }), requireBaseAccess(), controller.get);

  router.post(
    '/',
    requirePermission(PERMISSIONS.TRANSFER_CREATE),
    validate({ body: createTransferBody }),
    // Stock can only be sent FROM a base the caller controls; any destination is allowed.
    requireBaseAccess({ param: 'sourceBaseId', sources: ['body'] }),
    idempotent(),
    controller.create,
  );
  router.post(
    '/:id/complete',
    requirePermission(PERMISSIONS.TRANSFER_COMPLETE),
    validate({ params: idParams, body: completeTransferBody }),
    requireBaseAccess({ sources: [] }),
    idempotent(),
    controller.complete,
  );
  router.post(
    '/:id/cancel',
    requirePermission(PERMISSIONS.TRANSFER_CANCEL),
    validate({ params: idParams, body: cancelTransferBody }),
    requireBaseAccess({ sources: [] }),
    idempotent(),
    controller.cancel,
  );

  return router;
}
