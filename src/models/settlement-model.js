const { db } = require("../config/database");

function getSettlement(teamId, month) {
  const row = db.prepare("SELECT * FROM settlements WHERE team_id = ? AND month = ?").get(teamId, month);
  if (!row) {
    return null;
  }
  return {
    ...row,
    result_json: JSON.parse(row.result_json)
  };
}

function saveSettlement(teamId, month, result) {
  db.prepare(
    `
      INSERT INTO settlements (team_id, month, result_json)
      VALUES (?, ?, ?)
      ON CONFLICT(team_id, month)
      DO UPDATE SET result_json = excluded.result_json, created_at = CURRENT_TIMESTAMP
    `
  ).run(teamId, month, JSON.stringify(result));
  return getSettlement(teamId, month);
}

module.exports = {
  getSettlement,
  saveSettlement
};
