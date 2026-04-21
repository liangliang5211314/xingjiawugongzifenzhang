const { getDashboard } = require('../services/dashboard-service');
const { getStats } = require('../services/record-service');

function dashboardController(req, res, next) {
  try { res.json({ ok: true, data: getDashboard() }); }
  catch (e) { next(e); }
}

function yearStatsController(req, res, next) {
  try { res.json({ ok: true, data: getStats('year') }); }
  catch (e) { next(e); }
}

function monthStatsController(req, res, next) {
  try { res.json({ ok: true, data: getStats('month') }); }
  catch (e) { next(e); }
}

module.exports = { dashboardController, yearStatsController, monthStatsController };
