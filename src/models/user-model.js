const { db } = require("../config/database");

function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

function createUser({ username, password, role, team_id }) {
  const result = db
    .prepare("INSERT INTO users (username, password, role, team_id) VALUES (?, ?, ?, ?)")
    .run(username, password, role, team_id || null);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
}

module.exports = {
  getUserByUsername,
  createUser
};
