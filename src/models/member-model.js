const { db } = require("../config/database");

function getMembersByTeamId(teamId) {
  return db
    .prepare(
      `
      SELECT m.id, m.name, tm.team_id, tm.is_leader
      FROM members m
      INNER JOIN team_members tm ON tm.member_id = m.id
      WHERE tm.team_id = ?
      ORDER BY tm.is_leader DESC, m.id ASC
      `
    )
    .all(teamId);
}

function getMemberById(id) {
  return db.prepare("SELECT * FROM members WHERE id = ?").get(id);
}

function createMember({ name }) {
  const result = db.prepare("INSERT INTO members (name) VALUES (?)").run(name);
  return getMemberById(result.lastInsertRowid);
}

function addMemberToTeam({ member_id, team_id, is_leader }) {
  db.prepare(
    "INSERT OR IGNORE INTO team_members (member_id, team_id, is_leader) VALUES (?, ?, ?)"
  ).run(member_id, team_id, is_leader ? 1 : 0);
}

function memberBelongsToTeam(memberId, teamId) {
  return !!db
    .prepare("SELECT id FROM team_members WHERE member_id = ? AND team_id = ?")
    .get(memberId, teamId);
}

module.exports = {
  getMembersByTeamId,
  getMemberById,
  createMember,
  addMemberToTeam,
  memberBelongsToTeam
};
