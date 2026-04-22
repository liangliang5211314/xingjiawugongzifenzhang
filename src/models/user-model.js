const { db } = require('../config/database');

function findByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function findByOpenid(openid) {
  return db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
}

function getUserTeamIds(userId) {
  return db.prepare('SELECT team_id FROM user_teams WHERE user_id = ?').all(userId).map(r => r.team_id);
}

function setUserTeams(userId, teamIds) {
  db.transaction(() => {
    db.prepare('DELETE FROM user_teams WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT OR IGNORE INTO user_teams (user_id, team_id) VALUES (?, ?)');
    for (const tid of teamIds) ins.run(userId, tid);
    db.prepare('UPDATE users SET team_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(teamIds[0] || null, userId);
  })();
}

function listUsers({ teamId, role } = {}) {
  let sql = `
    SELECT u.id, u.name, u.mobile, u.username, u.role, u.openid, u.team_id, u.status,
           u.jingfen_mobile, u.jingfen_password, u.jingfen_realname, u.created_at, u.updated_at,
           (SELECT GROUP_CONCAT(ut.team_id) FROM user_teams ut WHERE ut.user_id = u.id) as team_ids_str
    FROM users u WHERE 1=1
  `;
  const params = [];
  if (teamId) {
    sql += ' AND EXISTS (SELECT 1 FROM user_teams ut WHERE ut.user_id = u.id AND ut.team_id = ?)';
    params.push(teamId);
  }
  if (role) { sql += ' AND u.role = ?'; params.push(role); }
  sql += ' ORDER BY u.id ASC';
  return db.prepare(sql).all(...params).map(u => {
    u.team_ids = u.team_ids_str ? u.team_ids_str.split(',').map(Number) : (u.team_id ? [u.team_id] : []);
    delete u.team_ids_str;
    return u;
  });
}

function createUser({ name, mobile, username, password_hash, role, openid, unionid, team_id }) {
  const info = db.prepare(`
    INSERT INTO users (name, mobile, username, password_hash, role, openid, unionid, team_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name || null, mobile || null, username || null, password_hash || null,
    role || 'member', openid || null, unionid || null, team_id || null
  );
  return findById(info.lastInsertRowid);
}

function updateUser(id, fields) {
  const allowed = ['name', 'mobile', 'username', 'password_hash', 'role', 'openid', 'unionid', 'team_id', 'status', 'jingfen_mobile', 'jingfen_password', 'jingfen_realname'];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (!sets.length) return findById(id);
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return findById(id);
}

function upsertWechatUser({ openid, unionid, name }) {
  let user = findByOpenid(openid);
  if (user) {
    const updates = { unionid: unionid || user.unionid };
    if (!user.name) updates.name = name;
    updateUser(user.id, updates);
    return { user: findById(user.id), isNew: false };
  }
  user = createUser({ name: name || '', openid, unionid, role: 'member' });
  return { user, isNew: true };
}

function deleteUserById(id) {
  db.prepare('DELETE FROM user_teams WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = { findByUsername, findById, findByOpenid, getUserTeamIds, setUserTeams, listUsers, createUser, updateUser, upsertWechatUser, deleteUserById };
