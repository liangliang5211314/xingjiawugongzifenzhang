const { runSettlement, fetchSettlement, fetchSettlementById, getSettlements } = require('../services/settlement-service');
const { pushSettlement } = require('../services/wechat-push-service');

function runSettlementController(req, res, next) {
  try {
    const { team_id, month } = req.body;
    res.json({ ok: true, data: runSettlement(Number(team_id), month) });
  } catch (e) { next(e); }
}

function listSettlementsController(req, res, next) {
  try {
    const { team_id, month } = req.query;
    res.json({ ok: true, data: getSettlements({ teamId: team_id ? Number(team_id) : undefined, month }) });
  } catch (e) { next(e); }
}

async function pushSettlementController(req, res, next) {
  try {
    const settlement = fetchSettlementById(Number(req.params.id));
    const result = await pushSettlement(settlement);
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
}

module.exports = { runSettlementController, listSettlementsController, pushSettlementController };
