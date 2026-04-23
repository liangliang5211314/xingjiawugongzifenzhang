/**
 * 自动结算服务 — 外挂式增强，不修改任何已有逻辑
 *
 * 调用方：record-controller 在保存收入记录后异步调用 checkAndRun
 */

const { getTeamById } = require('../models/team-model');
const { getRuleMembers } = require('../models/team-rule-member-model');
const { getSettlement } = require('../models/settlement-model');
const { db } = require('../config/database');
const { runSettlement } = require('./settlement-service');
const wecomWebhookService = require('./wecom-webhook-service');

// 查询该团队该月已有至少一条记录的成员列表
function getSubmittedMembers(teamId, month) {
  return db.prepare(
    'SELECT DISTINCT person_name FROM income_records WHERE team_id = ? AND month = ?'
  ).all(teamId, month).map(r => r.person_name);
}

async function checkAndRun(teamId, month) {
  try {
    const team = getTeamById(teamId);
    if (!team) return;
    if (!team.auto_settle_enabled) return;

    // 应提交成员 = team_rule_members 配置的成员
    const ruleMembers = getRuleMembers(teamId);
    if (ruleMembers.length === 0) return;

    const required = ruleMembers.map(m => m.member_name);
    const submitted = getSubmittedMembers(teamId, month);

    // 检查：每个应提交成员都在已提交列表里
    const allSubmitted = required.every(name => submitted.includes(name));
    if (!allSubmitted) return;

    // 幂等：该月结算已存在则不重复触发
    const existing = getSettlement(teamId, month);
    if (existing) {
      console.log(`[autoSettle] ${team.name} ${month} 结算已存在，跳过自动触发`);
      // 但如果结算已存在且启用自动推送，尝试补推（若未推过）
      if (team.auto_push_enabled && team.wecom_webhook_url) {
        await wecomWebhookService.push(team, existing).catch(e => {
          console.error('[autoSettle] 补推失败:', e.message);
        });
      }
      return;
    }

    console.log(`[autoSettle] ${team.name} ${month} 全员提交完成，开始自动结算...`);
    const settlement = runSettlement(teamId, month);
    console.log(`[autoSettle] ✅ ${team.name} ${month} 自动结算完成`);

    if (team.auto_push_enabled && team.wecom_webhook_url) {
      await wecomWebhookService.push(team, settlement).catch(e => {
        console.error('[autoSettle] 推送失败:', e.message);
      });
    }
  } catch (e) {
    // 自动结算异常只记录日志，不影响主流程
    console.error('[autoSettle] 异常:', e.message);
  }
}

module.exports = { checkAndRun };
