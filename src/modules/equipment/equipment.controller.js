import { paginationMeta, requestContext, sendData } from '../../utils/http.js';
import * as equipmentService from './equipment.service.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { items, total } = await equipmentService.listEquipment(query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}

export async function get(req, res) {
  sendData(res, await equipmentService.getEquipment(req.validated.params.id));
}

export async function create(req, res) {
  const equipment = await equipmentService.createEquipment(req.user, req.validated.body, requestContext(req));
  sendData(res, equipment, { status: 201 });
}

export async function listTypes(req, res) {
  sendData(res, await equipmentService.listEquipmentTypes(req.validated.query));
}
