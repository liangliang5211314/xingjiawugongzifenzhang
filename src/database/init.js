const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { db } = require("../config/database");
const { env } = require("../config/env");

function initDatabase() {
  const sqlPath = path.join(__dirname, "init.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  db.exec(sql);

  const existingAdmin = db.prepare("SELECT id FROM users WHERE username = ?").get(env.adminUsername);
  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync(env.adminPassword, 10);
    db.prepare(
      "INSERT INTO users (username, password, role, team_id) VALUES (?, ?, 'admin', NULL)"
    ).run(env.adminUsername, passwordHash);
  }
}

if (require.main === module) {
  initDatabase();
  console.log("Database initialized.");
}

module.exports = { initDatabase };
