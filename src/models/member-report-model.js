const { db } = require('../config/database');

function upsertReport({ userId, teamId, month, amount, screenshot, note }) {
  db.prepare(`
    INSERT INTO member_income_reports (user_id, team_id, month, amount, screenshot, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, team_id, month) DO UPDATE SET
      amount = excluded.amount,
      screenshot = COALESCE(excluded.screenshot, screenshot),
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, teamId, month, amount, screenshot || null, note || null);
}

function getMyReport(userId, teamId, month) {
  return db.prepare(
    'SELECT * FROM member_income_reports WHERE user_id=? AND team_id=? AND month=?'
  ).get(userId, teamId, month);
}

function listReports({ teamId, month } = {}) {
  let sql = `
    SELECT r.*, u.name as user_name, u.jingfen_realname, t.name as team_name
    FROM member_income_reports r
    JOIN users u ON r.user_id = u.id
    JOIN teams t ON r.team_id = t.id
    WHERE 1=1
  `;
  const params = [];
  if (teamId) { sql += ' AND r.team_id = ?'; params.push(teamId); }
  if (month)  { sql += ' AND r.month = ?';   params.push(month); }
  sql += ' ORDER BY r.month DESC, u.name ASC';
  return db.prepare(sql).all(...params);
}

module.exports = { upsertReport, getMyReport, listReports };
