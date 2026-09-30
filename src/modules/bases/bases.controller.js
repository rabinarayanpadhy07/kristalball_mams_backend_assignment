import { sendData } from '../../utils/http.js';
import * as basesService from './bases.service.js';

export async function list(req, res) {
  sendData(res, await basesService.listBases(req.baseScope));
}

export async function get(req, res) {
  sendData(res, await basesService.getBase(req.baseScope));
}

export async function directory(_req, res) {
  sendData(res, await basesService.listDirectory());
}
