import { paginationMeta, requestContext, sendData } from '../../utils/http.js';
import * as expendituresService from './expenditures.service.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { items, total } = await expendituresService.listExpenditures(req.baseScope, query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}

export async function get(req, res) {
  sendData(res, await expendituresService.getExpenditure(req.baseScope, req.validated.params.id));
}

export async function create(req, res) {
  const expenditure = await expendituresService.createExpenditure(
    req.user,
    req.baseScope,
    req.validated.body,
    requestContext(req),
  );
  sendData(res, expenditure, { status: 201 });
}
