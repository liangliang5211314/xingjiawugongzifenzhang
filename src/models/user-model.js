const { db } = require("../config/database");

function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function getUserByWxOpenId(openid) {
  return db
    .prepare("SELECT * FROM users WHERE wx_openid = ? OR wechat_openid = ?")
    .get(openid, openid);
}

function createUser({
  username,
  password,
  role,
  team_id,
  uid = null,
  phone = "",
  nickname = "",
  bio = "",
  region = "",
  status = "normal",
  avatar_url = "",
  wx_openid = null,
  wechat_openid = null,
  wechat_unionid = null,
  last_login = null
}) {
  const result = db
    .prepare(
      `
      INSERT INTO users (
        username, password, role, team_id, uid, phone, nickname, bio, region, status,
        avatar_url, wx_openid, wechat_openid, wechat_unionid, last_login
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      username,
      password,
      role,
      team_id || null,
      uid,
      phone,
      nickname,
      bio,
      region,
      status,
      avatar_url,
      wx_openid,
      wechat_openid,
      wechat_unionid,
      last_login
    );
  return getUserById(result.lastInsertRowid);
}

function addUserToTeams(userId, teamIds) {
  const insert = db.prepare("INSERT OR IGNORE INTO user_teams (user_id, team_id) VALUES (?, ?)");
  teamIds.forEach((teamId) => insert.run(userId, teamId));
}

function getUserTeamIds(userId) {
  return db
    .prepare("SELECT team_id FROM user_teams WHERE user_id = ? ORDER BY team_id ASC")
    .all(userId)
    .map((row) => row.team_id);
}

function updateUserWechatProfile(userId, payload) {
  db.prepare(
    `
    UPDATE users
    SET nickname = ?,
        avatar_url = ?,
        region = ?,
        wx_openid = ?,
        wechat_openid = ?,
        wechat_unionid = ?,
        last_login = ?
    WHERE id = ?
    `
  ).run(
    payload.nickname || "",
    payload.avatar_url || "",
    payload.region || "",
    payload.wx_openid || null,
    payload.wechat_openid || null,
    payload.wechat_unionid || null,
    payload.last_login || null,
    userId
  );
  return getUserById(userId);
}

function touchLastLogin(userId, lastLogin) {
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(lastLogin, userId);
}

module.exports = {
  getUserByUsername,
  getUserById,
  getUserByWxOpenId,
  createUser,
  addUserToTeams,
  getUserTeamIds,
  updateUserWechatProfile,
  touchLastLogin
};
