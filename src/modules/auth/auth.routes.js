import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireTrustedOrigin } from '../../middleware/trustedOrigin.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import { emptyBody, loginBody } from './auth.schemas.js';

export function authRouter(limiters) {
  const router = Router();

  router.post('/login', limiters.login, validate({ body: loginBody }), controller.login);
  router.post('/refresh', limiters.auth, requireTrustedOrigin(), validate({ body: emptyBody }), controller.refresh);
  router.post('/logout', limiters.auth, requireTrustedOrigin(), controller.logout);
  router.get('/me', requireAuth(), controller.me);

  return router;
}
