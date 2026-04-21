const { db } = require('../config/database');

db.exec(`
  CREATE TABLE IF NOT EXISTS team_rule_members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_name TEXT NOT NULL,
    rule_mode   TEXT NOT NULL DEFAULT 'ratio',
    ratio       REAL,
    formula     TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, member_name)
  )
`);

function getRuleMembers(teamId) {
  return db.prepare('SELECT * FROM team_rule_members WHERE team_id = ? ORDER BY id ASC').all(teamId);
}

function setRuleMembers(teamId, members) {
  db.transaction(() => {
    db.prepare('DELETE FROM team_rule_members WHERE team_id = ?').run(teamId);
    const ins = db.prepare(
      'INSERT INTO team_rule_members (team_id, member_name, rule_mode, ratio, formula) VALUES (?, ?, ?, ?, ?)'
    );
    for (const m of members) {
      if (!m.member_name) continue;
      ins.run(teamId, m.member_name, m.rule_mode || 'ratio',
        m.ratio != null ? Number(m.ratio) : null, m.formula || null);
    }
  })();
}

module.exports = { getRuleMembers, setRuleMembers };
