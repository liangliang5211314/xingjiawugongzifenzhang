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
    addColumnIfMissing('users', 'jingfen_mobile TEXT');
    addColumnIfMissing('users', 'jingfen_password TEXT');
    addColumnIfMissing('users', 'jingfen_realname TEXT');
    addColumnIfMissing('users', 'jd_account TEXT');
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

  // member_income_reports：添加 item_type / item_name 列并更换 UNIQUE 约束
  if (tableExists('member_income_reports') && !columnExists('member_income_reports', 'item_name')) {
    db.exec(`
      ALTER TABLE member_income_reports RENAME TO mir_old;
      CREATE TABLE member_income_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        team_id INTEGER NOT NULL REFERENCES teams(id),
        month TEXT NOT NULL,
        item_type TEXT NOT NULL DEFAULT 'income',
        item_name TEXT NOT NULL DEFAULT '京粉收益',
        amount INTEGER NOT NULL DEFAULT 0,
        screenshot TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, team_id, month, item_name)
      );
      CREATE INDEX IF NOT EXISTS idx_member_reports_team_month ON member_income_reports(team_id, month);
      INSERT INTO member_income_reports (id, user_id, team_id, month, item_type, item_name, amount, screenshot, note, created_at, updated_at)
        SELECT id, user_id, team_id, month, 'income', '京粉收益', amount, screenshot, note, created_at, updated_at FROM mir_old;
      DROP TABLE mir_old;
    `);
  }

  // 创建 user_teams 并迁移旧 users.team_id 数据
  if (!tableExists('user_teams')) {
    db.exec(`
      CREATE TABLE user_teams (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, team_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_teams_user ON user_teams(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_teams_team ON user_teams(team_id);
    `);
  }
  // 每次启动都同步：users.team_id → user_teams（INSERT OR IGNORE 不会重复）
  db.exec(`
    INSERT OR IGNORE INTO user_teams (user_id, team_id)
    SELECT id, team_id FROM users WHERE team_id IS NOT NULL
  `);

  // teams表补充新列
  if (tableExists('teams')) {
    addColumnIfMissing('teams', 'status INTEGER NOT NULL DEFAULT 1');
    addColumnIfMissing('teams', 'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    addColumnIfMissing('teams', 'wecom_webhook_url TEXT');
    addColumnIfMissing('teams', 'auto_settle_enabled INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('teams', 'auto_push_enabled INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('teams', 'report_member_names TEXT');
    addColumnIfMissing('teams', 'leader_user_id INTEGER REFERENCES users(id)');
  }

  // wecom_push_logs 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS wecom_push_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id       INTEGER NOT NULL,
      month         TEXT    NOT NULL,
      webhook_url   TEXT,
      request_json  TEXT,
      response_text TEXT,
      status        TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_wecom_push_logs_team_month
      ON wecom_push_logs(team_id, month);
  `);

  // settlements表补充 year_compare_prev3
  if (tableExists('settlements')) {
    addColumnIfMissing('settlements', 'year_compare_prev3 INTEGER');
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
