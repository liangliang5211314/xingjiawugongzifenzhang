const { db } = require("../config/database");

function createRecord({ team_id, member_id, type, amount, month }) {
  const result = db
    .prepare("INSERT INTO records (team_id, member_id, type, amount, month) VALUES (?, ?, ?, ?, ?)")
    .run(team_id, member_id, type, amount, month);
  return db.prepare("SELECT * FROM records WHERE id = ?").get(result.lastInsertRowid);
}

function getRecordsByTeamAndMonth(teamId, month) {
  return db
    .prepare("SELECT * FROM records WHERE team_id = ? AND month = ? ORDER BY created_at ASC, id ASC")
    .all(teamId, month);
}

function getYearStats() {
  return db
    .prepare(
      `
      SELECT substr(month, 1, 4) AS year, team_id,
             SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income_cents,
             SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense_cents,
             SUM(CASE WHEN type = 'tax' THEN amount ELSE 0 END) AS tax_cents
      FROM records
      GROUP BY substr(month, 1, 4), team_id
      ORDER BY year DESC, team_id ASC
      `
    )
    .all();
}

function getMonthStats() {
  return db
    .prepare(
      `
      SELECT month, team_id,
             SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) AS income_cents,
             SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS expense_cents,
             SUM(CASE WHEN type = 'tax' THEN amount ELSE 0 END) AS tax_cents
      FROM records
      GROUP BY month, team_id
      ORDER BY month DESC, team_id ASC
      `
    )
    .all();
}

module.exports = {
  createRecord,
  getRecordsByTeamAndMonth,
  getYearStats,
  getMonthStats
};
