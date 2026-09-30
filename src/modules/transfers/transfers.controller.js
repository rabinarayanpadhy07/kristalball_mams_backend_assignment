import { targetBaseId } from '../../rbac/scope.js';
import { paginationMeta, requestContext, sendData } from '../../utils/http.js';
import * as transfersService from './transfers.service.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { items, total } = await transfersService.listTransfers(req.baseScope, query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}

export async function get(req, res) {
  sendData(res, await transfersService.getTransfer(req.baseScope, req.validated.params.id));
}

export async function create(req, res) {
  const input = { ...req.validated.body, sourceBaseId: targetBaseId(req.baseScope, 'sourceBaseId') };
  const transfer = await transfersService.createTransfer(req.user, input, requestContext(req));
  sendData(res, transfer, { status: 201 });
}

export async function complete(req, res) {
  const transfer = await transfersService.completeTransfer(
    req.user,
    req.baseScope,
    req.validated.params.id,
    requestContext(req),
  );
  sendData(res, transfer);
}

export async function cancel(req, res) {
  const transfer = await transfersService.cancelTransfer(
    req.user,
    req.baseScope,
    req.validated.params.id,
    req.validated.body.reason,
    requestContext(req),
  );
  sendData(res, transfer);
}
