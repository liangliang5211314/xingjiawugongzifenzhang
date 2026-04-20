const { db } = require("../config/database");

function getMembersByTeamId(teamId) {
  return db.prepare("SELECT * FROM members WHERE team_id = ? ORDER BY id ASC").all(teamId);
}

function getMemberById(id) {
  return db.prepare("SELECT * FROM members WHERE id = ?").get(id);
}

function createMember({ name, team_id, is_leader }) {
  const result = db
    .prepare("INSERT INTO members (name, team_id, is_leader) VALUES (?, ?, ?)")
    .run(name, team_id, is_leader ? 1 : 0);
  return getMemberById(result.lastInsertRowid);
}

module.exports = {
  getMembersByTeamId,
  getMemberById,
  createMember
};
