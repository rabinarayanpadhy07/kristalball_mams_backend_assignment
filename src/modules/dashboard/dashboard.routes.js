import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireBaseAccess } from '../../middleware/baseAccess.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../../rbac/permissions.js';
import * as controller from './dashboard.controller.js';
import { dashboardQuery } from './dashboard.schemas.js';

export function dashboardRouter() {
  const router = Router();
  router.use(requireAuth(), requirePermission(PERMISSIONS.DASHBOARD_READ));

  router.get('/summary', validate({ query: dashboardQuery }), requireBaseAccess(), controller.summary);
  router.get('/movement-breakdown', validate({ query: dashboardQuery }), requireBaseAccess(), controller.movementBreakdown);
  router.get('/trends', validate({ query: dashboardQuery }), requireBaseAccess(), controller.trends);
  router.get('/distribution', validate({ query: dashboardQuery }), requireBaseAccess(), controller.distribution);
  router.get('/activity', validate({ query: dashboardQuery }), requireBaseAccess(), controller.activity);

  return router;
}
