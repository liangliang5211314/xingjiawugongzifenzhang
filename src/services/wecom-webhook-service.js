/**
 * 企业微信 Webhook 推送服务
 * 仅在本文件内操作 wecom_push_logs，不影响任何已有推送逻辑
 */

const https = require('https');
const http  = require('http');
const { db } = require('../config/database');

db.exec(`
  CREATE TABLE IF NOT EXISTS wecom_push_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id       INTEGER NOT NULL,
    month         TEXT    NOT NULL,
    webhook_url   TEXT,
    request_json  TEXT,
    response_text TEXT,
    status        TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_wecom_push_logs_team_month
    ON wecom_push_logs(team_id, month);
`);

function logPush({ team_id, month, webhook_url, request_json, response_text, status }) {
  db.prepare(`
    INSERT INTO wecom_push_logs (team_id, month, webhook_url, request_json, response_text, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(team_id, month, webhook_url || '', JSON.stringify(request_json), response_text || '', status);
}

function alreadyPushed(teamId, month) {
  const row = db.prepare(
    "SELECT id FROM wecom_push_logs WHERE team_id = ? AND month = ? AND status = 'success' LIMIT 1"
  ).get(teamId, month);
  return !!row;
}

function buildMarkdown(team, settlement) {
  const r = settlement.result_json || {};
  const fmt = v => parseFloat(v || 0).toFixed(2);
  const lines = [];

  lines.push(`## 【月度结算报告】${team.name} · ${settlement.month}`);
  lines.push('---');
  lines.push('**💰 收支概览**');
  lines.push(`> 总收入：**¥${fmt(r.total_income)}**`);
  if (parseFloat(r.total_expense || 0) > 0) lines.push(`> 总支出：¥${fmt(r.total_expense)}`);
  if (parseFloat(r.total_tax    || 0) > 0) lines.push(`> 退　税：¥${fmt(r.total_tax)}`);
  lines.push(`> 可分配：¥${fmt(r.distributable)}`);

  // 同比
  const parts = settlement.month.split('-');
  const yr = Number(parts[0]), mn = parts[1];
  const curVal = parseFloat(r.total_income || 0);
  const pct = (ref) => {
    if (!ref || ref <= 0) return '';
    const p = ((curVal - ref / 100) / (ref / 100) * 100).toFixed(1);
    return `（${p >= 0 ? '+' : ''}${p}%）`;
  };
  const cmpLines = [];
  if (settlement.year_compare_last  != null) cmpLines.push(`去年同月 ${yr-1}-${mn}：¥${(settlement.year_compare_last/100).toFixed(2)}${pct(settlement.year_compare_last)}`);
  if (settlement.year_compare_prev2 != null) cmpLines.push(`前年同月 ${yr-2}-${mn}：¥${(settlement.year_compare_prev2/100).toFixed(2)}${pct(settlement.year_compare_prev2)}`);
  if (settlement.year_compare_prev3 != null) cmpLines.push(`前前年同月 ${yr-3}-${mn}：¥${(settlement.year_compare_prev3/100).toFixed(2)}${pct(settlement.year_compare_prev3)}`);
  if (cmpLines.length) {
    lines.push('---');
    lines.push('**📊 同比对比**');
    cmpLines.forEach(l => lines.push(`> ${l}`));
  }

  // 成员明细
  lines.push('---');
  lines.push('**👥 成员分账明细**');
  (r.members || []).forEach(m => {
    const diff = parseFloat(m.diff);
    const diffStr = Math.abs(diff) < 0.01 ? '✅已平衡'
      : diff > 0 ? `+¥${fmt(diff)}（待收）`
      : `-¥${fmt(Math.abs(diff))}（需支付）`;
    lines.push(`**${m.name}**　应收 ¥${fmt(m.should_get)}　实收 ¥${fmt(m.actual)}　${diffStr}`);
  });

  // 转账方案
  if ((r.transfers || []).length > 0) {
    lines.push('---');
    lines.push('**💸 最优转账方案**');
    r.transfers.forEach(t => lines.push(`> ${t.from} → ${t.to}：¥${fmt(t.amount)}`));
  }

  return lines.join('\n');
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve(text));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

async function push(team, settlement) {
  const webhookUrl = team.wecom_webhook_url;
  if (!webhookUrl) return;

  // 幂等：已推送成功则跳过
  if (alreadyPushed(team.id, settlement.month)) {
    console.log(`[wecom] ${team.name} ${settlement.month} 已推送，跳过`);
    return;
  }

  const content = buildMarkdown(team, settlement);
  const payload = { msgtype: 'markdown', markdown: { content } };

  let responseText = '';
  let status = 'fail';
  try {
    responseText = await httpPost(webhookUrl, payload);
    const resp = JSON.parse(responseText);
    status = (resp.errcode === 0) ? 'success' : 'fail';
    if (status === 'success') {
      console.log(`[wecom] ✅ ${team.name} ${settlement.month} 推送成功`);
    } else {
      console.error(`[wecom] ❌ ${team.name} ${settlement.month} 推送失败:`, responseText);
    }
  } catch (e) {
    responseText = String(e.message || e);
    console.error(`[wecom] ❌ ${team.name} ${settlement.month} 推送异常:`, e.message);
  }

  logPush({
    team_id: team.id,
    month: settlement.month,
    webhook_url: webhookUrl,
    request_json: payload,
    response_text: responseText,
    status,
  });
}

// 手动推送：跳过幂等检查，直接发送并记录日志；失败时 throw（由 controller 返回错误）
async function pushForce(team, settlement) {
  const webhookUrl = team.wecom_webhook_url;
  if (!webhookUrl) throw new Error('未配置 Webhook URL');

  const content = buildMarkdown(team, settlement);
  const payload = { msgtype: 'markdown', markdown: { content } };

  let responseText = '';
  let status = 'fail';
  try {
    responseText = await httpPost(webhookUrl, payload);
    const resp = JSON.parse(responseText);
    status = (resp.errcode === 0) ? 'success' : 'fail';
    if (status !== 'success') {
      throw new Error(`企业微信返回错误：${responseText}`);
    }
    console.log(`[wecom] ✅ ${team.name} ${settlement.month} 手动推送成功`);
  } finally {
    logPush({
      team_id: team.id,
      month: settlement.month,
      webhook_url: webhookUrl,
      request_json: payload,
      response_text: responseText,
      status,
    });
  }
}

module.exports = { push, pushForce, alreadyPushed };
