import { paginationMeta, sendData } from '../../utils/http.js';
import * as assetsService from './assets.service.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { items, total } = await assetsService.listAssets(req.baseScope, query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}
