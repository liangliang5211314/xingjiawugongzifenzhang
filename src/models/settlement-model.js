const { db } = require('../config/database');

function mapRow(row) {
  if (!row) return null;
  return { ...row, result_json: row.result_json ? JSON.parse(row.result_json) : null };
}

function getSettlement(teamId, month) {
  return mapRow(db.prepare('SELECT * FROM settlements WHERE team_id = ? AND month = ?').get(teamId, month));
}

function getSettlementById(id) {
  return mapRow(db.prepare('SELECT * FROM settlements WHERE id = ?').get(id));
}

function listSettlements({ teamId, month } = {}) {
  let sql = 'SELECT * FROM settlements WHERE 1=1';
  const params = [];
  if (teamId) { sql += ' AND team_id = ?'; params.push(teamId); }
  if (month)  { sql += ' AND month = ?';   params.push(month); }
  sql += ' ORDER BY month DESC, team_id ASC';
  return db.prepare(sql).all(...params).map(mapRow);
}

function saveSettlement(teamId, month, { total_income, total_expense, year_compare_last, year_compare_prev2, result }) {
  db.prepare(`
    INSERT INTO settlements (team_id, month, total_income, total_expense, year_compare_last, year_compare_prev2, result_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(team_id, month) DO UPDATE SET
      total_income       = excluded.total_income,
      total_expense      = excluded.total_expense,
      year_compare_last  = excluded.year_compare_last,
      year_compare_prev2 = excluded.year_compare_prev2,
      result_json        = excluded.result_json,
      updated_at         = CURRENT_TIMESTAMP
  `).run(teamId, month, total_income, total_expense,
    year_compare_last ?? null, year_compare_prev2 ?? null,
    JSON.stringify(result));
  return getSettlement(teamId, month);
}

function markPushed(id) {
  db.prepare('UPDATE settlements SET pushed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  return getSettlementById(id);
}

// 查询某月总收入（用于年同比，优先从settlements读）
function getMonthTotalIncome(teamId, month) {
  const row = db.prepare('SELECT total_income FROM settlements WHERE team_id = ? AND month = ?').get(teamId, month);
  return row?.total_income ?? null;
}

function deleteSettlementById(id) {
  db.prepare('DELETE FROM settlements WHERE id = ?').run(id);
}

module.exports = { getSettlement, getSettlementById, listSettlements, saveSettlement, markPushed, getMonthTotalIncome, deleteSettlementById };
