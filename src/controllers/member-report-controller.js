const { findById, getUserTeamIds } = require('../models/user-model');
const { upsertReport, getMyReports, listReports } = require('../models/member-report-model');
const { createRecord, listRecords } = require('../models/record-model');
const { HttpError } = require('../utils/http-error');

// POST /member/report
function submitReportController(req, res, next) {
  try {
    const user = findById(req.user.id);
    if (!user.name) throw new HttpError(400, '请先在个人资料中设置真实姓名');

    const { month, amount, note, team_id, item_type, item_name } = req.body;
    if (!month)  throw new HttpError(400, '请选择月份');
    if (amount == null || amount === '') throw new HttpError(400, '请填写金额');

    const teamId = Number(team_id);
    if (!teamId) throw new HttpError(400, '请选择团队');

    const userTeamIds = getUserTeamIds(user.id);
    if (!userTeamIds.includes(teamId)) throw new HttpError(403, '您不属于该团队');

    const resolvedItemType = item_type || 'income';
    const resolvedItemName = item_name || '京粉收益';

    const amountCents = Math.floor(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents < 0) throw new HttpError(400, '金额格式不正确');

    const screenshot = req.file ? '/uploads/' + req.file.filename : null;

    upsertReport({
      userId: user.id, teamId, month,
      itemType: resolvedItemType,
      itemName: resolvedItemName,
      amount: amountCents, screenshot, note,
    });

    // 同步到 income_records（有则更新，无则新增）
    const records = listRecords({ teamId, month });
    const existing = records.find(r =>
      r.person_name === user.name &&
      r.item_type === resolvedItemType &&
      r.item_name === resolvedItemName
    );
    if (existing) {
      const { db } = require('../config/database');
      db.prepare('UPDATE income_records SET amount=?, note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(amountCents, note || null, existing.id);
    } else {
      createRecord({
        team_id: teamId, month,
        person_name: user.name,
        item_type: resolvedItemType,
        item_name: resolvedItemName,
        amount: amountCents,
        note: note || null,
        created_by: user.id,
      });
    }

    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /member/report?month=&team_id=  — 返回数组
function getMyReportController(req, res, next) {
  try {
    const user = findById(req.user.id);
    const teamId = req.query.team_id ? Number(req.query.team_id) : null;
    if (!teamId) return res.json({ ok: true, data: [] });
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const reports = getMyReports(user.id, teamId, month);
    res.json({ ok: true, data: reports.map(r => ({ ...r, amount: r.amount / 100 })) });
  } catch (e) { next(e); }
}

// GET /api/member-reports  — 管理员查看所有上报
function listReportsController(req, res, next) {
  try {
    const { team_id, month } = req.query;
    const list = listReports({
      teamId: team_id ? Number(team_id) : undefined,
      month,
    }).map(r => ({ ...r, amount: r.amount / 100 }));
    res.json({ ok: true, data: list });
  } catch (e) { next(e); }
}

module.exports = { submitReportController, getMyReportController, listReportsController };
