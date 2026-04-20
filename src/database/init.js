const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { db } = require("../config/database");
const { env } = require("../config/env");

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columnExists(tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row.name === columnName);
}

function addColumnIfMissing(tableName, columnDefinition) {
  const [columnName] = columnDefinition.split(" ");
  if (!columnExists(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
}

function runMigrations() {
  addColumnIfMissing("users", "uid TEXT");
  addColumnIfMissing("users", "phone TEXT DEFAULT ''");
  addColumnIfMissing("users", "nickname TEXT");
  addColumnIfMissing("users", "bio TEXT DEFAULT ''");
  addColumnIfMissing("users", "region TEXT DEFAULT ''");
  addColumnIfMissing("users", "status TEXT DEFAULT 'normal'");
  addColumnIfMissing("users", "avatar_url TEXT");
  addColumnIfMissing("users", "wx_openid TEXT");
  addColumnIfMissing("users", "wechat_openid TEXT");
  addColumnIfMissing("users", "wechat_unionid TEXT");
  addColumnIfMissing("users", "last_login TEXT");

  if (tableExists("members")) {
    addColumnIfMissing("members", "team_id INTEGER");
    addColumnIfMissing("members", "is_leader INTEGER NOT NULL DEFAULT 0");
  }

  if (tableExists("team_members") && columnExists("members", "team_id")) {
    const legacyMembers = db
      .prepare("SELECT id, team_id, is_leader FROM members WHERE team_id IS NOT NULL")
      .all();
    const insertMembership = db.prepare(
      "INSERT OR IGNORE INTO team_members (team_id, member_id, is_leader) VALUES (?, ?, ?)"
    );
    legacyMembers.forEach((member) => {
      insertMembership.run(member.team_id, member.id, member.is_leader ? 1 : 0);
    });
  }

  if (tableExists("user_teams") && columnExists("users", "team_id")) {
    const legacyUsers = db
      .prepare("SELECT id, team_id FROM users WHERE role = 'team_user' AND team_id IS NOT NULL")
      .all();
    const insertUserTeam = db.prepare(
      "INSERT OR IGNORE INTO user_teams (user_id, team_id) VALUES (?, ?)"
    );
    legacyUsers.forEach((user) => {
      insertUserTeam.run(user.id, user.team_id);
    });
  }
}

function initDatabase() {
  const sqlPath = path.join(__dirname, "init.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  db.exec(sql);
  runMigrations();

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
