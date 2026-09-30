import { targetBaseId } from '../../rbac/scope.js';
import { paginationMeta, requestContext, sendData } from '../../utils/http.js';
import * as assignmentsService from './assignments.service.js';

export async function list(req, res) {
  const query = req.validated.query;
  const { items, total } = await assignmentsService.listAssignments(req.baseScope, query);
  sendData(res, items, { meta: paginationMeta({ page: query.page, pageSize: query.pageSize, total }) });
}

export async function get(req, res) {
  sendData(res, await assignmentsService.getAssignment(req.baseScope, req.validated.params.id));
}

export async function create(req, res) {
  const input = { ...req.validated.body, baseId: targetBaseId(req.baseScope) };
  const assignment = await assignmentsService.createAssignment(req.user, input, requestContext(req));
  sendData(res, assignment, { status: 201 });
}

export async function returnItems(req, res) {
  const result = await assignmentsService.returnAssignment(
    req.user,
    req.baseScope,
    req.validated.params.id,
    req.validated.body,
    requestContext(req),
  );
  sendData(res, result);
}
