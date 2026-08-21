const { findById, getUserTeamIds } = require('../models/user-model');
const { upsertReport, getMyReports, listReports } = require('../models/member-report-model');
const { createRecord, listRecords } = require('../models/record-model');
const { db } = require('../config/database');
const autoSettleService = require('../services/auto-settle-service');
const { HttpError } = require('../utils/http-error');
const { assertCanManageTeam } = require('../middleware/auth');
const { toCents } = require('../utils/money');
const { currentMonth } = require('../utils/date');

function submitReportController(req, res, next) {
  try {
    const user = findById(req.user.id);
    if (!user.name) throw new HttpError(400, '请先在个人资料中设置真实姓名');

    const { month, amount, note, team_id, item_type, item_name } = req.body;
    if (!month) throw new HttpError(400, '请选择月份');
    if (amount == null || amount === '') throw new HttpError(400, '请填写金额');

    const teamId = Number(team_id);
    if (!teamId) throw new HttpError(400, '请选择团队');

    const userTeamIds = getUserTeamIds(user.id);
    if (!userTeamIds.includes(teamId)) throw new HttpError(403, '您不属于该团队');

    const resolvedItemType = item_type || 'income';
    const resolvedItemName = item_name || '京粉收益';
    // 与后台录入一致：四舍五入到分（toCents 内部 Math.round）
    let amountCents;
    try {
      amountCents = toCents(amount);
    } catch (e) {
      throw new HttpError(400, '金额格式不正确');
    }
    if (amountCents < 0) throw new HttpError(400, '金额格式不正确');

    const screenshot = req.file ? '/uploads/' + req.file.filename : null;

    // 上报 + 回写台账是一个整体，包进事务避免半截数据
    db.transaction(() => {
      upsertReport({
        userId: user.id,
        teamId,
        month,
        itemType: resolvedItemType,
        itemName: resolvedItemName,
        amount: amountCents,
        screenshot,
        note,
      });

      const records = listRecords({ teamId, month });
      const existing = records.find(r =>
        r.person_name === user.name &&
        r.item_type === resolvedItemType &&
        r.item_name === resolvedItemName
      );
      if (existing) {
        db.prepare('UPDATE income_records SET amount=?, note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(amountCents, note || null, existing.id);
      } else {
        createRecord({
          team_id: teamId,
          month,
          person_name: user.name,
          item_type: resolvedItemType,
          item_name: resolvedItemName,
          amount: amountCents,
          note: note || null,
          created_by: user.id,
        });
      }
    })();

    res.json({ ok: true });

    // 与后台录入一致：上报后异步检查是否触发自动结算，不阻塞响应
    setImmediate(() => {
      autoSettleService.checkAndRun(teamId, month).catch(() => {});
    });
  } catch (e) { next(e); }
}

function getMyReportController(req, res, next) {
  try {
    const user = findById(req.user.id);
    const teamId = req.query.team_id ? Number(req.query.team_id) : null;
    if (!teamId) return res.json({ ok: true, data: [] });
    const month = req.query.month || currentMonth();
    const reports = getMyReports(user.id, teamId, month);
    res.json({ ok: true, data: reports.map(r => ({ ...r, amount: r.amount / 100 })) });
  } catch (e) { next(e); }
}

function listReportsController(req, res, next) {
  try {
    const { team_id, month } = req.query;
    const teamId = team_id ? Number(team_id) : undefined;
    if (req.user.role !== 'admin' && teamId) {
      assertCanManageTeam(req.user, teamId);
    }
    const list = listReports({
      teamId: req.user.role === 'admin' ? teamId : undefined,
      teamIds: req.user.role === 'admin' ? undefined : (teamId ? [teamId] : req.user.managed_team_ids),
      month,
    }).map(r => ({ ...r, amount: r.amount / 100 }));
    res.json({ ok: true, data: list });
  } catch (e) { next(e); }
}

module.exports = { submitReportController, getMyReportController, listReportsController };
