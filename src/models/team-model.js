const { db } = require('../config/database');

function mapTeam(row) {
  if (!row) return null;
  return { ...row, rule_config: JSON.parse(row.rule_config || '{}') };
}

function getAllTeams() {
  return db.prepare('SELECT * FROM teams ORDER BY id ASC').all().map(mapTeam);
}

function getTeamById(id) {
  return mapTeam(db.prepare('SELECT * FROM teams WHERE id = ?').get(id));
}

function getTeamByName(name) {
  return mapTeam(db.prepare('SELECT * FROM teams WHERE name = ?').get(name));
}

function createTeam({ name, rule_type, rule_config }) {
  const info = db.prepare('INSERT INTO teams (name, rule_type, rule_config) VALUES (?, ?, ?)')
    .run(name, rule_type, JSON.stringify(rule_config || {}));
  return getTeamById(info.lastInsertRowid);
}

function updateTeam(id, { name, rule_type, rule_config, status }) {
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const vals = [];
  if (name !== undefined)        { sets.push('name = ?');        vals.push(name); }
  if (rule_type !== undefined)   { sets.push('rule_type = ?');   vals.push(rule_type); }
  if (rule_config !== undefined) { sets.push('rule_config = ?'); vals.push(JSON.stringify(rule_config)); }
  if (status !== undefined)      { sets.push('status = ?');      vals.push(status); }
  vals.push(id);
  db.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getTeamById(id);
}

module.exports = { getAllTeams, getTeamById, getTeamByName, createTeam, updateTeam };
