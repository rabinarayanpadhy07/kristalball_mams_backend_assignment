import { targetBaseId } from '../../rbac/scope.js';
import { paginationMeta, requestContext, sendData } from '../../utils/http.js';
import * as purchasesService from './purchases.service.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { items, total } = await purchasesService.listPurchases(req.baseScope, query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}

export async function get(req, res) {
  sendData(res, await purchasesService.getPurchase(req.baseScope, req.validated.params.id));
}

export async function create(req, res) {
  const input = { ...req.validated.body, baseId: targetBaseId(req.baseScope) };
  const purchase = await purchasesService.createPurchase(req.user, input, requestContext(req));
  sendData(res, purchase, { status: 201 });
}
