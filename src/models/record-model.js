const { db } = require('../config/database');

function getRecordById(id) {
  return db.prepare('SELECT * FROM income_records WHERE id = ?').get(id);
}

function listRecords({ teamId, month } = {}) {
  let sql = 'SELECT * FROM income_records WHERE 1=1';
  const params = [];
  if (teamId) { sql += ' AND team_id = ?'; params.push(teamId); }
  if (month)  { sql += ' AND month = ?';   params.push(month); }
  sql += ' ORDER BY created_at DESC, id DESC';
  return db.prepare(sql).all(...params);
}

function getRecordsByTeamAndMonth(teamId, month) {
  return db.prepare(
    'SELECT * FROM income_records WHERE team_id = ? AND month = ? ORDER BY item_type ASC, id ASC'
  ).all(teamId, month);
}

function createRecord({ team_id, month, person_name, item_type, item_name, amount, payer_name, note, created_by }) {
  const info = db.prepare(`
    INSERT INTO income_records (team_id, month, person_name, item_type, item_name, amount, payer_name, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(team_id, month, person_name, item_type, item_name || null, amount, payer_name || null, note || null, created_by || null);
  return getRecordById(info.lastInsertRowid);
}

function updateRecord(id, fields) {
  const allowed = ['month', 'person_name', 'item_type', 'item_name', 'amount', 'payer_name', 'note'];
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
  }
  vals.push(id);
  db.prepare(`UPDATE income_records SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getRecordById(id);
}

function deleteRecord(id) {
  db.prepare('DELETE FROM income_records WHERE id = ?').run(id);
}

// 聚合某月某团队的总收入（分）
function sumIncomeByTeamMonth(teamId, month) {
  const row = db.prepare(
    "SELECT SUM(amount) AS total FROM income_records WHERE team_id = ? AND month = ? AND item_type = 'income'"
  ).get(teamId, month);
  return row?.total || 0;
}

// 仪表盘统计：按年聚合
function getYearStats() {
  return db.prepare(`
    SELECT substr(month,1,4) AS year, team_id,
           SUM(CASE WHEN item_type='income'  THEN amount ELSE 0 END) AS income_cents,
           SUM(CASE WHEN item_type='expense' THEN ABS(amount) ELSE 0 END) AS expense_cents,
           SUM(CASE WHEN item_type='tax'     THEN amount ELSE 0 END) AS tax_cents
    FROM income_records
    GROUP BY substr(month,1,4), team_id
    ORDER BY year DESC, team_id ASC
  `).all();
}

// 仪表盘统计：按月聚合
function getMonthStats() {
  return db.prepare(`
    SELECT month, team_id,
           SUM(CASE WHEN item_type='income'  THEN amount ELSE 0 END) AS income_cents,
           SUM(CASE WHEN item_type='expense' THEN ABS(amount) ELSE 0 END) AS expense_cents,
           SUM(CASE WHEN item_type='tax'     THEN amount ELSE 0 END) AS tax_cents
    FROM income_records
    GROUP BY month, team_id
    ORDER BY month DESC, team_id ASC
  `).all();
}

// 获取某月某团队所有成员姓名（distinct）
function getPersonNames(teamId, month) {
  return db.prepare(
    'SELECT DISTINCT person_name FROM income_records WHERE team_id = ? AND month = ? ORDER BY person_name ASC'
  ).all(teamId, month).map(r => r.person_name);
}

// 按成员汇总某月 income 类型收入（返回 Map: name -> cents）
function sumIncomeByPersonMonth(teamId, month) {
  const rows = db.prepare(
    "SELECT person_name, SUM(amount) AS total FROM income_records WHERE team_id = ? AND month = ? AND item_type = 'income' GROUP BY person_name"
  ).all(teamId, month);
  const map = {};
  rows.forEach(r => { map[r.person_name] = r.total || 0; });
  return map;
}

module.exports = {
  getRecordById, listRecords, getRecordsByTeamAndMonth,
  createRecord, updateRecord, deleteRecord,
  sumIncomeByTeamMonth, sumIncomeByPersonMonth,
  getYearStats, getMonthStats, getPersonNames
};
