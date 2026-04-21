-- 团队收益结算系统 数据库结构
-- 所有金额字段单位为"分"（×100），避免浮点误差

PRAGMA foreign_keys = ON;

-- 团队
CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  rule_type   TEXT    NOT NULL CHECK(rule_type IN ('standard','zteam','custom')),
  rule_config TEXT,                             -- JSON，存分账规则参数
  status      INTEGER NOT NULL DEFAULT 1,       -- 1启用 0停用
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 用户（管理员 + 成员合一张表）
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,                           -- 真实姓名，与income_records.person_name对应
  mobile        TEXT,
  username      TEXT UNIQUE,                    -- 管理员登录用
  password_hash TEXT,                           -- 管理员密码bcrypt
  role          TEXT    NOT NULL CHECK(role IN ('admin','member')) DEFAULT 'member',
  openid        TEXT UNIQUE,                    -- 微信openid
  unionid       TEXT,
  team_id       INTEGER REFERENCES teams(id),
  jingfen_mobile   TEXT,                        -- 京粉手机号
  jingfen_password TEXT,                        -- 京粉密码
  jingfen_realname TEXT,                        -- 京粉实名人
  status        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 收入台账（核心原始数据）
CREATE TABLE IF NOT EXISTS income_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  month       TEXT    NOT NULL,                 -- YYYY-MM
  person_name TEXT    NOT NULL,                 -- 自由文本，UI下拉辅助
  item_type   TEXT    NOT NULL CHECK(item_type IN ('income','tax','expense','adjust')),
  item_name   TEXT,                             -- 如：A收益、B收益、退税、软件费
  amount      INTEGER NOT NULL DEFAULT 0,       -- 分（×100），支出为负数
  payer_name  TEXT,                             -- 支出垫付人（item_type=expense时填）
  note        TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_income_records_team_month ON income_records(team_id, month);
CREATE INDEX IF NOT EXISTS idx_income_records_month ON income_records(month);

-- 结算快照（每月每团队一条）
CREATE TABLE IF NOT EXISTS settlements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id            INTEGER NOT NULL REFERENCES teams(id),
  month              TEXT    NOT NULL,          -- YYYY-MM
  total_income       INTEGER NOT NULL DEFAULT 0,
  total_expense      INTEGER NOT NULL DEFAULT 0,
  year_compare_last  INTEGER,                   -- 去年同月总收入（分）
  year_compare_prev2 INTEGER,                   -- 前年同月总收入（分）
  result_json        TEXT,                      -- 完整结算结果JSON
  pushed_at          TEXT,                      -- 最后推送时间
  created_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, month)
);

-- 成员收益上报（每月可上报多条不同项目）
CREATE TABLE IF NOT EXISTS member_income_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  team_id      INTEGER NOT NULL REFERENCES teams(id),
  month        TEXT    NOT NULL,
  item_type    TEXT    NOT NULL DEFAULT 'income', -- income / expense
  item_name    TEXT    NOT NULL DEFAULT '京粉收益',
  amount       INTEGER NOT NULL DEFAULT 0,        -- 分（×100），截断小数
  screenshot   TEXT,                              -- 图片路径 /uploads/xxx.jpg
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, team_id, month, item_name)
);
CREATE INDEX IF NOT EXISTS idx_member_reports_team_month ON member_income_reports(team_id, month);

-- 用户-团队多对多关联
CREATE TABLE IF NOT EXISTS user_teams (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_user_teams_user ON user_teams(user_id);
CREATE INDEX IF NOT EXISTS idx_user_teams_team ON user_teams(team_id);

-- 推送日志
CREATE TABLE IF NOT EXISTS push_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id   INTEGER REFERENCES settlements(id),
  user_id         INTEGER REFERENCES users(id),
  openid          TEXT,
  push_type       TEXT,                         -- wechat_template
  request_json    TEXT,
  response_json   TEXT,
  status          TEXT,                         -- success / failed
  created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
