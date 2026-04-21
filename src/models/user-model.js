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

function listUsers({ teamId, role } = {}) {
  let sql = 'SELECT id,name,mobile,username,role,openid,team_id,status,jingfen_mobile,jingfen_password,jingfen_realname,created_at,updated_at FROM users WHERE 1=1';
  const params = [];
  if (teamId) { sql += ' AND team_id = ?'; params.push(teamId); }
  if (role)   { sql += ' AND role = ?';    params.push(role); }
  sql += ' ORDER BY id ASC';
  return db.prepare(sql).all(...params);
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

// 微信登录：找到或创建member用户
function upsertWechatUser({ openid, unionid, name }) {
  let user = findByOpenid(openid);
  if (user) {
    const updates = { unionid: unionid || user.unionid };
    if (!user.name) updates.name = name; // 只在用户未手动设置姓名时才用微信昵称
    updateUser(user.id, updates);
    return { user: findById(user.id), isNew: false };
  }
  user = createUser({ name: name || '', openid, unionid, role: 'member' });
  return { user, isNew: true };
}

module.exports = { findByUsername, findById, findByOpenid, listUsers, createUser, updateUser, upsertWechatUser };
