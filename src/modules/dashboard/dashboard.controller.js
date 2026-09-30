import { sendData } from '../../utils/http.js';
import * as dashboardService from './dashboard.service.js';

export async function summary(req, res) {
  sendData(res, await dashboardService.getSummary(req.baseScope, req.validated.query));
}

export async function movementBreakdown(req, res) {
  sendData(res, await dashboardService.getMovementBreakdown(req.baseScope, req.validated.query));
}

export async function trends(req, res) {
  sendData(res, await dashboardService.getTrends(req.baseScope, req.validated.query));
}

export async function distribution(req, res) {
  sendData(res, await dashboardService.getDistribution(req.baseScope, req.validated.query));
}

export async function activity(req, res) {
  sendData(res, await dashboardService.getActivity(req.baseScope, req.validated.query));
}
