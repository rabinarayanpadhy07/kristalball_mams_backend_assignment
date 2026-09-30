/**
 * Response envelope used by every endpoint:
 *   success → { data, meta? }
 *   error   → { error: { code, message, details?, requestId } }   (see middleware/errorHandler.js)
 */
export function sendData(res, data, { status = 200, meta } = {}) {
  return res.status(status).json(meta ? { data, meta } : { data });
}

/** Request metadata recorded on audit rows. */
export function requestContext(req) {
  return { requestId: req.id, ip: req.ip, userAgent: req.get('user-agent') };
}

export function paginationMeta({ page, pageSize, total }) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
