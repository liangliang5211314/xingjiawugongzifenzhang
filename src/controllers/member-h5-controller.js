const { findById } = require('../models/user-model');
const { getTeamById } = require('../models/team-model');
const { listRecords } = require('../models/record-model');
const { listSettlements } = require('../models/settlement-model');
const { safeUser } = require('../services/auth-service');
const { fromCents } = require('../utils/money');

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// GET /member/me
function memberMeController(req, res, next) {
  try {
    const user = findById(req.user.id);
    const team = user.team_id ? getTeamById(user.team_id) : null;
    res.json({ ok: true, data: { user: safeUser(user), team } });
  } catch (e) { next(e); }
}

// GET /member/income/current
function memberCurrentIncomeController(req, res, next) {
  try {
    const user = findById(req.user.id);
    if (!user.name || !user.team_id) return res.json({ ok: true, data: null, message: '账号未完善信息' });
    const month = req.query.month || currentMonth();
    const records = listRecords({ teamId: user.team_id, month });
    const mine = records.filter(r => r.person_name === user.name)
      .map(r => ({ ...r, amount: fromCents(r.amount) }));
    const [settlements] = listSettlements({ teamId: user.team_id, month }) || [];
    const mySettlement = settlements?.result_json?.members?.find(m => m.name === user.name) || null;
    res.json({ ok: true, data: { month, records: mine, settlement: mySettlement, year_compare: {
      last:  settlements?.year_compare_last  != null ? fromCents(settlements.year_compare_last)  : null,
      prev2: settlements?.year_compare_prev2 != null ? fromCents(settlements.year_compare_prev2) : null,
    }}});
  } catch (e) { next(e); }
}

// GET /member/income/history
function memberIncomeHistoryController(req, res, next) {
  try {
    const user = findById(req.user.id);
    if (!user.name || !user.team_id) return res.json({ ok: true, data: [] });
    const settlements = listSettlements({ teamId: user.team_id });
    const history = settlements.map(s => {
      const myData = s.result_json?.members?.find(m => m.name === user.name);
      return {
        month: s.month,
        total_income: fromCents(s.total_income),
        should_get: myData?.should_get || null,
        diff: myData?.diff || null,
        pushed_at: s.pushed_at,
      };
    });
    res.json({ ok: true, data: history });
  } catch (e) { next(e); }
}

module.exports = { memberMeController, memberCurrentIncomeController, memberIncomeHistoryController };
