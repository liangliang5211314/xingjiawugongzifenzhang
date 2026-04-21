const { syncRecords, syncSettlement } = require('../services/feishu-service');

async function syncRecordsController(req, res, next) {
  try {
    const { team_id, month } = req.body;
    const result = await syncRecords({ teamId: team_id ? Number(team_id) : undefined, month });
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
}

async function syncSettlementController(req, res, next) {
  try {
    const { team_id, month } = req.body;
    const result = await syncSettlement({ teamId: team_id ? Number(team_id) : undefined, month });
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
}

module.exports = { syncRecordsController, syncSettlementController };
