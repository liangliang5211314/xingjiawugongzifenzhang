const axios = require('axios');
const { env } = require('../config/env');
const { db } = require('../config/database');
const { fromCents } = require('../utils/money');
const { getAllTeams } = require('../models/team-model');

let _tenantToken = null;
let _tokenExpiry = 0;

async function getTenantToken() {
  if (_tenantToken && Date.now() < _tokenExpiry) return _tenantToken;
  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: env.feishuAppId,
    app_secret: env.feishuAppSecret,
  });
  if (res.data.code !== 0) throw new Error(`飞书获取token失败: ${res.data.msg}`);
  _tenantToken = res.data.tenant_access_token;
  _tokenExpiry = Date.now() + (res.data.expire - 60) * 1000;
  return _tenantToken;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// 写入飞书表格某个sheet的数据（覆盖写）
async function writeSheet(sheetId, rows) {
  if (!rows.length) return;
  const token = await getTenantToken();
  const range = `${sheetId}!A1:Z${rows.length + 1}`;
  await axios.put(
    `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${env.feishuSpreadsheetToken}/values`,
    { valueRange: { range, values: rows } },
    { headers: authHeader(token) }
  );
}

// 同步income_records到飞书records工作表
async function syncRecords({ teamId, month } = {}) {
  if (!env.feishuAppId || !env.feishuRecordsSheetId) throw new Error('飞书配置未填写');

  let sql = `
    SELECT r.*, t.name AS team_name
    FROM income_records r
    JOIN teams t ON t.id = r.team_id
    WHERE 1=1
  `;
  const params = [];
  if (teamId) { sql += ' AND r.team_id = ?'; params.push(teamId); }
  if (month)  { sql += ' AND r.month = ?';   params.push(month); }
  sql += ' ORDER BY r.month DESC, r.team_id ASC, r.id ASC';
  const records = db.prepare(sql).all(...params);

  const teamMap = new Map(getAllTeams().map(t => [t.id, t.name]));

  const header = ['月份','团队','姓名','项目类型','项目名称','金额','支出人','备注','创建时间'];
  const rows = [header, ...records.map(r => [
    r.month,
    teamMap.get(r.team_id) || r.team_id,
    r.person_name,
    r.item_type,
    r.item_name || '',
    fromCents(r.amount),
    r.payer_name || '',
    r.note || '',
    r.created_at,
  ])];

  await writeSheet(env.feishuRecordsSheetId, rows);
  return { synced: records.length };
}

// 同步settlements到飞书settlements工作表
async function syncSettlement({ teamId, month } = {}) {
  if (!env.feishuAppId || !env.feishuSettlementsSheetId) throw new Error('飞书配置未填写');

  let sql = `
    SELECT s.*, t.name AS team_name
    FROM settlements s
    JOIN teams t ON t.id = s.team_id
    WHERE 1=1
  `;
  const params = [];
  if (teamId) { sql += ' AND s.team_id = ?'; params.push(teamId); }
  if (month)  { sql += ' AND s.month = ?';   params.push(month); }
  sql += ' ORDER BY s.month DESC, s.team_id ASC';
  const settlements = db.prepare(sql).all(...params);

  const header = ['月份','团队','总收入','总支出','去年同月收入','前年同月收入','结算摘要','是否已推送','推送时间'];
  const rows = [header, ...settlements.map(s => {
    const result = s.result_json ? JSON.parse(s.result_json) : {};
    const summary = (result.members || []).map(m => `${m.name}:${m.should_get}`).join('；');
    return [
      s.month,
      s.team_name,
      fromCents(s.total_income),
      fromCents(s.total_expense),
      s.year_compare_last  != null ? fromCents(s.year_compare_last) : '',
      s.year_compare_prev2 != null ? fromCents(s.year_compare_prev2) : '',
      summary,
      s.pushed_at ? '是' : '否',
      s.pushed_at || '',
    ];
  })];

  await writeSheet(env.feishuSettlementsSheetId, rows);
  return { synced: settlements.length };
}

module.exports = { syncRecords, syncSettlement };
