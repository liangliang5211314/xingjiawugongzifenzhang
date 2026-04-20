const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { env } = require("./env");

const dbDir = path.dirname(env.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(env.dbPath);
db.pragma("foreign_keys = ON");

module.exports = { db };
