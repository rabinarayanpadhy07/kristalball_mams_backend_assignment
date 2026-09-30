import { paginationMeta, sendData } from '../../utils/http.js';
import * as inventoryQueries from './inventory.queries.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { items, total } = await inventoryQueries.listBalances(req.baseScope, query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}

export async function listForBase(req, res) {
  const query = req.validated.query;
  const { items, total } = await inventoryQueries.listBaseBalances(req.baseScope, query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}
