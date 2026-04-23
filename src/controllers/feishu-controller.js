const { syncRecords, syncSettlement } = require('../services/feishu-service');
const { assertCanManageTeam } = require('../middleware/auth');

async function syncRecordsController(req, res, next) {
  try {
    const { team_id, month } = req.body;
    const teamId = team_id ? Number(team_id) : undefined;
    if (teamId) assertCanManageTeam(req.user, teamId);
    const result = await syncRecords({ teamId, month });
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
}

async function syncSettlementController(req, res, next) {
  try {
    const { team_id, month } = req.body;
    const teamId = team_id ? Number(team_id) : undefined;
    if (teamId) assertCanManageTeam(req.user, teamId);
    const result = await syncSettlement({ teamId, month });
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
}

module.exports = { syncRecordsController, syncSettlementController };
