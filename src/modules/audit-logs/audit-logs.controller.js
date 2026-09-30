import { paginationMeta, sendData } from '../../utils/http.js';
import * as auditLogsService from './audit-logs.service.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { items, total } = await auditLogsService.listAuditLogs(query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}

export async function get(req, res) {
  sendData(res, await auditLogsService.getAuditLog(req.validated.params.id));
}

export async function facets(_req, res) {
  sendData(res, await auditLogsService.getFacets());
}
