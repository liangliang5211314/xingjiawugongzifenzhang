const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { env } = require('../config/env');

function tableExists(name) {
  return !!db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').get('table', name);
}

function columnExists(tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some(r => r.name === columnName);
}

function addColumnIfMissing(tableName, columnDef) {
  const colName = columnDef.split(' ')[0];
  if (!columnExists(tableName, colName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`);
  }
}

// 迁移旧schema到新schema
function runMigrations() {
  // users表：重命名password→password_hash，补充新列
  if (tableExists('users')) {
    // 如果有旧的password列但没有password_hash列，重建users表
    if (columnExists('users', 'password') && !columnExists('users', 'password_hash')) {
      db.exec(`
        ALTER TABLE users RENAME TO users_old;
        CREATE TABLE users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          name          TEXT,
          mobile        TEXT,
          username      TEXT UNIQUE,
          password_hash TEXT,
          role          TEXT NOT NULL CHECK(role IN ('admin','member')) DEFAULT 'member',
          openid        TEXT UNIQUE,
          unionid       TEXT,
          team_id       INTEGER REFERENCES teams(id),
          status        INTEGER NOT NULL DEFAULT 1,
          created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, name, username, password_hash, role, openid, team_id, created_at, updated_at)
          SELECT id,
                 COALESCE(nickname, ''),
                 username,
                 password,
                 CASE WHEN role = 'admin' THEN 'admin' ELSE 'member' END,
                 COALESCE(wx_openid, wechat_openid),
                 team_id,
                 created_at,
                 CURRENT_TIMESTAMP
          FROM users_old;
        DROP TABLE users_old;
      `);
    }
    // 补充可能缺失的新列
    addColumnIfMissing('users', 'name TEXT');
    addColumnIfMissing('users', 'mobile TEXT');
    addColumnIfMissing('users', 'openid TEXT');
    addColumnIfMissing('users', 'unionid TEXT');
    addColumnIfMissing('users', 'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  }

  // 将旧records表数据迁移到income_records
  if (tableExists('records') && !tableExists('income_records')) {
    db.exec(`
      CREATE TABLE income_records (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id     INTEGER NOT NULL REFERENCES teams(id),
        month       TEXT    NOT NULL,
        person_name TEXT    NOT NULL DEFAULT '',
        item_type   TEXT    NOT NULL CHECK(item_type IN ('income','tax','expense','adjust')),
        item_name   TEXT,
        amount      INTEGER NOT NULL DEFAULT 0,
        payer_name  TEXT,
        note        TEXT,
        created_by  INTEGER REFERENCES users(id),
        created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_income_records_team_month ON income_records(team_id, month);
      CREATE INDEX IF NOT EXISTS idx_income_records_month ON income_records(month);
    `);
    // 迁移旧records数据（member_id→person_name通过members表join）
    if (tableExists('members')) {
      db.exec(`
        INSERT INTO income_records (team_id, month, person_name, item_type, item_name, amount, created_at, updated_at)
          SELECT r.team_id, r.month,
                 COALESCE(m.name, '未知'),
                 r.type,
                 r.type,
                 r.amount,
                 r.created_at,
                 CURRENT_TIMESTAMP
          FROM records r
          LEFT JOIN members m ON m.id = r.member_id;
      `);
    }
  }

  // settlements表补充新列
  if (tableExists('settlements')) {
    addColumnIfMissing('settlements', 'total_income INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('settlements', 'total_expense INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('settlements', 'year_compare_last INTEGER');
    addColumnIfMissing('settlements', 'year_compare_prev2 INTEGER');
    addColumnIfMissing('settlements', 'pushed_at TEXT');
    addColumnIfMissing('settlements', 'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  }

  // teams表补充新列
  if (tableExists('teams')) {
    addColumnIfMissing('teams', 'status INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing('teams', 'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  }
}

function initDatabase() {
  // 备份现有数据库（如果存在）
  const dbPath = env.dbPath || './data/app.db';
  if (fs.existsSync(dbPath)) {
    const backupPath = `${dbPath}.backup-${Date.now()}`;
    try {
      fs.copyFileSync(dbPath, backupPath);
      console.log(`已备份数据库到: ${backupPath}`);
    } catch (e) {
      // 备份失败不阻断初始化
    }
  }

  // 确保data目录存在
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 执行建表SQL
  const sqlPath = path.join(__dirname, 'init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  db.exec(sql);

  // 执行迁移
  runMigrations();

  // 创建默认管理员（如果不存在）
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(env.adminUsername);
  if (!existing) {
    const hash = bcrypt.hashSync(env.adminPassword, 10);
    db.prepare(
      'INSERT INTO users (name, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?)'
    ).run('管理员', env.adminUsername, hash, 'admin', 1);
    console.log(`已创建管理员账号: ${env.adminUsername}`);
  }
}

if (require.main === module) {
  initDatabase();
  console.log('数据库初始化完成。');
  process.exit(0);
}

module.exports = { initDatabase };
