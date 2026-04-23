const { runSettlement, fetchSettlementById, getSettlements } = require('../services/settlement-service');
const { pushSettlement } = require('../services/wechat-push-service');
const { deleteSettlementById } = require('../models/settlement-model');
const wecomWebhookService = require('../services/wecom-webhook-service');
const { getTeamById } = require('../models/team-model');
const { assertCanManageTeam } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');

function runSettlementController(req, res, next) {
  try {
    const { team_id, month } = req.body;
    assertCanManageTeam(req.user, Number(team_id));
    res.json({ ok: true, data: runSettlement(Number(team_id), month) });
  } catch (e) { next(e); }
}

function listSettlementsController(req, res, next) {
  try {
    const { team_id, month } = req.query;
    const teamId = team_id ? Number(team_id) : undefined;
    if (req.user.role === 'admin') {
      return res.json({ ok: true, data: getSettlements({ teamId, month }) });
    }
    if (teamId) {
      assertCanManageTeam(req.user, teamId);
      return res.json({ ok: true, data: getSettlements({ teamId, month }) });
    }
    res.json({ ok: true, data: getSettlements({ teamIds: req.user.managed_team_ids, month }) });
  } catch (e) { next(e); }
}

async function pushSettlementController(req, res, next) {
  try {
    const settlement = fetchSettlementById(Number(req.params.id));
    if (!settlement) throw new HttpError(404, '结算记录不存在');
    assertCanManageTeam(req.user, settlement.team_id);
    const result = await pushSettlement(settlement);
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
}

function deleteSettlementController(req, res, next) {
  try {
    const settlement = fetchSettlementById(Number(req.params.id));
    if (!settlement) throw new HttpError(404, '结算记录不存在');
    assertCanManageTeam(req.user, settlement.team_id);
    deleteSettlementById(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function wecomPushController(req, res, next) {
  try {
    const settlement = fetchSettlementById(Number(req.params.id));
    if (!settlement) throw new HttpError(404, '结算记录不存在');
    assertCanManageTeam(req.user, settlement.team_id);
    const team = getTeamById(settlement.team_id);
    if (!team || !team.wecom_webhook_url) {
      return res.status(400).json({ ok: false, message: '该团队未配置企业微信 Webhook，请先在团队管理中填写' });
    }
    await wecomWebhookService.pushForce(team, settlement);
    res.json({ ok: true, message: '推送成功' });
  } catch (e) { next(e); }
}

module.exports = { runSettlementController, listSettlementsController, pushSettlementController, deleteSettlementController, wecomPushController };
