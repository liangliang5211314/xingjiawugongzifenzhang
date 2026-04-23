const { db } = require('../config/database');

function mapTeam(row) {
  if (!row) return null;
  return {
    ...row,
    rule_config: JSON.parse(row.rule_config || '{}'),
    report_member_names: JSON.parse(row.report_member_names || '[]'),
  };
}

function getAllTeams() {
  return db.prepare('SELECT * FROM teams ORDER BY id ASC').all().map(mapTeam);
}

function getTeamsByLeaderUserId(userId) {
  return db.prepare('SELECT * FROM teams WHERE leader_user_id = ? ORDER BY id ASC').all(userId).map(mapTeam);
}

function getTeamById(id) {
  return mapTeam(db.prepare('SELECT * FROM teams WHERE id = ?').get(id));
}

function getTeamByName(name) {
  return mapTeam(db.prepare('SELECT * FROM teams WHERE name = ?').get(name));
}

function createTeam({ name, rule_type, rule_config, report_member_names, leader_user_id }) {
  const info = db.prepare(`
    INSERT INTO teams (name, rule_type, rule_config, report_member_names, leader_user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name,
    rule_type,
    JSON.stringify(rule_config || {}),
    JSON.stringify(report_member_names || []),
    leader_user_id || null
  );
  return getTeamById(info.lastInsertRowid);
}

function updateTeam(id, {
  name,
  rule_type,
  rule_config,
  status,
  wecom_webhook_url,
  auto_settle_enabled,
  auto_push_enabled,
  report_member_names,
  leader_user_id,
}) {
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const vals = [];
  if (name !== undefined)                { sets.push('name = ?');                vals.push(name); }
  if (rule_type !== undefined)           { sets.push('rule_type = ?');           vals.push(rule_type); }
  if (rule_config !== undefined)         { sets.push('rule_config = ?');         vals.push(JSON.stringify(rule_config)); }
  if (report_member_names !== undefined) { sets.push('report_member_names = ?'); vals.push(JSON.stringify(report_member_names || [])); }
  if (leader_user_id !== undefined)      { sets.push('leader_user_id = ?');      vals.push(leader_user_id || null); }
  if (status !== undefined)              { sets.push('status = ?');              vals.push(status); }
  if (wecom_webhook_url !== undefined)   { sets.push('wecom_webhook_url = ?');   vals.push(wecom_webhook_url || null); }
  if (auto_settle_enabled !== undefined) { sets.push('auto_settle_enabled = ?'); vals.push(auto_settle_enabled ? 1 : 0); }
  if (auto_push_enabled !== undefined)   { sets.push('auto_push_enabled = ?');   vals.push(auto_push_enabled ? 1 : 0); }
  vals.push(id);
  db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getTeamById(id);
}

function deleteTeamById(id) {
  db.transaction(() => {
    db.prepare('DELETE FROM income_records WHERE team_id = ?').run(id);
    db.prepare('DELETE FROM settlements WHERE team_id = ?').run(id);
    db.prepare('DELETE FROM wecom_push_logs WHERE team_id = ?').run(id);
    try { db.prepare('DELETE FROM team_rule_members WHERE team_id = ?').run(id); } catch (e) {}
    db.prepare('UPDATE users SET team_id = NULL WHERE team_id = ?').run(id);
    try { db.prepare('DELETE FROM user_teams WHERE team_id = ?').run(id); } catch (e) {}
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
  })();
}

module.exports = {
  getAllTeams,
  getTeamsByLeaderUserId,
  getTeamById,
  getTeamByName,
  createTeam,
  updateTeam,
  deleteTeamById,
};
