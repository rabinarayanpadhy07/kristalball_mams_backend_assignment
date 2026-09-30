import { Router } from 'express';
import { prisma } from './db/prisma.js';
import { assetsRouter } from './modules/assets/assets.routes.js';
import { assignmentsRouter } from './modules/assignments/assignments.routes.js';
import { auditLogsRouter } from './modules/audit-logs/audit-logs.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { basesRouter } from './modules/bases/bases.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { equipmentRouter, equipmentTypesRouter } from './modules/equipment/equipment.routes.js';
import { expendituresRouter } from './modules/expenditures/expenditures.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { purchasesRouter } from './modules/purchases/purchases.routes.js';
import { transfersRouter } from './modules/transfers/transfers.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { AppError } from './utils/errors.js';
import { sendData } from './utils/http.js';

export function apiRouter(limiters) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'Database is unreachable');
    }
    sendData(res, { status: 'ok' });
  });

  router.use('/auth', authRouter(limiters));
  router.use('/bases', basesRouter());
  router.use('/dashboard', dashboardRouter());
  router.use('/equipment-types', equipmentTypesRouter());
  router.use('/equipment', equipmentRouter());
  router.use('/inventory', inventoryRouter());
  router.use('/purchases', purchasesRouter());
  router.use('/transfers', transfersRouter());
  router.use('/assignments', assignmentsRouter());
  router.use('/expenditures', expendituresRouter());
  router.use('/assets', assetsRouter());
  router.use('/audit-logs', auditLogsRouter());
  router.use('/users', usersRouter());

  return router;
}
