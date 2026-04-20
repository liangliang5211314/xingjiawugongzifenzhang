const { db } = require("../config/database");

function mapTeam(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    rule_config: JSON.parse(row.rule_config || "{}")
  };
}

function getAllTeams() {
  return db.prepare("SELECT * FROM teams ORDER BY id ASC").all().map(mapTeam);
}

function getTeamById(id) {
  return mapTeam(db.prepare("SELECT * FROM teams WHERE id = ?").get(id));
}

function getTeamByName(name) {
  return mapTeam(db.prepare("SELECT * FROM teams WHERE name = ?").get(name));
}

function createTeam({ name, rule_type, rule_config }) {
  const result = db
    .prepare("INSERT INTO teams (name, rule_type, rule_config) VALUES (?, ?, ?)")
    .run(name, rule_type, JSON.stringify(rule_config || {}));
  return getTeamById(result.lastInsertRowid);
}

function updateTeam(id, { name, rule_type, rule_config }) {
  db.prepare(
    `
      UPDATE teams
      SET name = ?, rule_type = ?, rule_config = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(name, rule_type, JSON.stringify(rule_config || {}), id);
  return getTeamById(id);
}

module.exports = {
  getAllTeams,
  getTeamById,
  getTeamByName,
  createTeam,
  updateTeam
};
