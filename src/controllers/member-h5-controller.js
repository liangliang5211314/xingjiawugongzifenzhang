const { findById, getUserTeamIds, updateUser } = require('../models/user-model');
const { getTeamById } = require('../models/team-model');
const { listRecords } = require('../models/record-model');
const { listSettlements } = require('../models/settlement-model');
const { safeUser } = require('../services/auth-service');
const { fromCents } = require('../utils/money');

function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}

// GET /member/me
function memberMeController(req, res, next) {
  try {
    const user = findById(req.user.id);
    const teamIds = getUserTeamIds(user.id);
    const teams = teamIds.map(id => getTeamById(id)).filter(Boolean);
    res.json({ ok: true, data: { user: safeUser(user), teams } });
  } catch (e) { next(e); }
}

// GET /member/income/current?month=&team_id=
function memberCurrentIncomeController(req, res, next) {
  try {
    const user = findById(req.user.id);
    if (!user.name) return res.json({ ok: true, data: null, message: '账号未设置姓名' });
    const teamId = req.query.team_id ? Number(req.query.team_id) : null;
    if (!teamId) return res.json({ ok: true, data: null });
    const month = req.query.month || currentMonthStr();
    const records = listRecords({ teamId, month });
    const mine = records.filter(r => r.person_name === user.name)
      .map(r => ({ ...r, amount: fromCents(r.amount) }));
    const [settlement] = listSettlements({ teamId, month }) || [];
    const mySettlement = settlement?.result_json?.members?.find(m => m.name === user.name) || null;
    const memberCompareMap = settlement?.result_json?.member_compare || {};
    const myCompare = memberCompareMap[user.name] || {};
    res.json({ ok: true, data: {
      month, records: mine, settlement: mySettlement,
      total_income: settlement?.total_income != null ? fromCents(settlement.total_income) : null,
      year_compare: {
        last:  settlement?.year_compare_last  != null ? fromCents(settlement.year_compare_last)  : null,
        prev2: settlement?.year_compare_prev2 != null ? fromCents(settlement.year_compare_prev2) : null,
        prev3: settlement?.year_compare_prev3 != null ? fromCents(settlement.year_compare_prev3) : null,
      },
      member_compare: {
        last:  myCompare.last  != null ? fromCents(myCompare.last)  : null,
        prev2: myCompare.prev2 != null ? fromCents(myCompare.prev2) : null,
        prev3: myCompare.prev3 != null ? fromCents(myCompare.prev3) : null,
      },
    }});
  } catch (e) { next(e); }
}

// GET /member/income/history?team_id=
function memberIncomeHistoryController(req, res, next) {
  try {
    const user = findById(req.user.id);
    if (!user.name) return res.json({ ok: true, data: [] });
    const teamId = req.query.team_id ? Number(req.query.team_id) : user.team_id;
    if (!teamId) return res.json({ ok: true, data: [] });
    const settlements = listSettlements({ teamId });
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

// PUT /member/profile
function memberUpdateProfileController(req, res, next) {
  try {
    const { name, jingfen_mobile, jingfen_password, jingfen_realname } = req.body;
    const fields = {};
    if (name !== undefined)             fields.name = name;
    if (jingfen_mobile !== undefined)   fields.jingfen_mobile = jingfen_mobile;
    if (jingfen_password !== undefined) fields.jingfen_password = jingfen_password;
    if (jingfen_realname !== undefined) fields.jingfen_realname = jingfen_realname;
    updateUser(req.user.id, fields);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { memberMeController, memberCurrentIncomeController, memberIncomeHistoryController, memberUpdateProfileController };
