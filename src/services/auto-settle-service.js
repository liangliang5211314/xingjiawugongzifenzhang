/**
 * 自动结算服务
 *
 * 调用方：record-controller 在保存收入记录后异步调用 checkAndRun
 */

const { getTeamById } = require('../models/team-model');
const { getRuleMembers } = require('../models/team-rule-member-model');
const { getSettlement } = require('../models/settlement-model');
const { db } = require('../config/database');
const { runSettlement } = require('./settlement-service');
const wecomWebhookService = require('./wecom-webhook-service');

// 查询该团队该月已至少有一条记录的成员列表
function getSubmittedMembers(teamId, month) {
  return db.prepare(
    'SELECT DISTINCT person_name FROM income_records WHERE team_id = ? AND month = ?'
  ).all(teamId, month).map(r => r.person_name);
}

function getRequiredMembers(teamId, team) {
  const configured = Array.isArray(team.report_member_names)
    ? team.report_member_names.map(v => String(v || '').trim()).filter(Boolean)
    : [];
  if (configured.length > 0) return configured;

  const ruleMembers = getRuleMembers(teamId);
  return ruleMembers.map(m => m.member_name);
}

async function checkAndRun(teamId, month) {
  try {
    const team = getTeamById(teamId);
    if (!team) return;
    if (!team.auto_settle_enabled) return;

    const required = getRequiredMembers(teamId, team);
    if (required.length === 0) return;

    const submitted = getSubmittedMembers(teamId, month);
    const allSubmitted = required.every(name => submitted.includes(name));
    if (!allSubmitted) return;

    const existing = getSettlement(teamId, month);
    if (existing) {
      console.log(`[autoSettle] ${team.name} ${month} 结算已存在，跳过自动触发`);
      if (team.auto_push_enabled && team.wecom_webhook_url) {
        await wecomWebhookService.push(team, existing).catch(e => {
          console.error('[autoSettle] 补推失败:', e.message);
        });
      }
      return;
    }

    console.log(`[autoSettle] ${team.name} ${month} 指定成员已完成上报，开始自动结算...`);
    const settlement = runSettlement(teamId, month);
    console.log(`[autoSettle] ${team.name} ${month} 自动结算完成`);

    if (team.auto_push_enabled && team.wecom_webhook_url) {
      await wecomWebhookService.push(team, settlement).catch(e => {
        console.error('[autoSettle] 推送失败:', e.message);
      });
    }
  } catch (e) {
    console.error('[autoSettle] 异常:', e.message);
  }
}

module.exports = { checkAndRun };
