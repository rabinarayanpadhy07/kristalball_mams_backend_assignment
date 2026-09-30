import { paginationMeta, sendData } from '../../utils/http.js';
import * as usersService from './users.service.js';

export async function list(req, res) {
  const { page, pageSize } = req.validated.query;
  const { items, total } = await usersService.listUsers({ page, pageSize });
  sendData(res, items, { meta: paginationMeta({ page, pageSize, total }) });
}
