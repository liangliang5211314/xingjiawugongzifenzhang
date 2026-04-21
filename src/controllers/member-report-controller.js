const { findById } = require('../models/user-model');
const { upsertReport, getMyReport, listReports } = require('../models/member-report-model');
const { createRecord, listRecords } = require('../models/record-model');
const { HttpError } = require('../utils/http-error');

// POST /member/report  — 成员提交本月收益
function submitReportController(req, res, next) {
  try {
    const user = findById(req.user.id);
    if (!user.name)    throw new HttpError(400, '请先在个人资料中设置真实姓名');
    if (!user.team_id) throw new HttpError(400, '账号未绑定团队，请联系管理员');

    const { month, amount, note } = req.body;
    if (!month)  throw new HttpError(400, '请选择月份');
    if (amount == null || amount === '') throw new HttpError(400, '请填写收益金额');

    // 截断到分（忽略小数后两位之外）
    const amountCents = Math.floor(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents < 0) throw new HttpError(400, '金额格式不正确');

    const screenshot = req.file ? '/uploads/' + req.file.filename : null;

    upsertReport({
      userId: user.id,
      teamId: user.team_id,
      month,
      amount: amountCents,
      screenshot,
      note,
    });

    // 同步到 income_records（有则更新，无则新增）
    const records = listRecords({ teamId: user.team_id, month });
    const existing = records.find(r => r.person_name === user.name && r.item_type === 'income' && r.item_name === '京粉收益');
    if (existing) {
      const { db } = require('../config/database');
      db.prepare('UPDATE income_records SET amount=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(amountCents, existing.id);
    } else {
      createRecord({
        teamId: user.team_id,
        month,
        personName: user.name,
        itemType: 'income',
        itemName: '京粉收益',
        amount: amountCents,
        createdBy: user.id,
      });
    }

    res.json({ ok: true });
  } catch (e) { next(e); }
}

// GET /member/report?month=  — 查询我的上报
function getMyReportController(req, res, next) {
  try {
    const user = findById(req.user.id);
    if (!user.team_id) return res.json({ ok: true, data: null });
    const month = req.query.month || new Date().toISOString().slice(0,7);
    const report = getMyReport(user.id, user.team_id, month);
    res.json({ ok: true, data: report ? { ...report, amount: report.amount / 100 } : null });
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
