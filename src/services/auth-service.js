const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { findByUsername, findById, upsertWechatUser } = require('../models/user-model');
const { HttpError } = require('../utils/http-error');

function buildToken(user) {
  return jwt.sign(
    { sub: user.id, id: user.id, username: user.username, role: user.role, team_id: user.team_id || null },
    env.jwtSecret,
    { expiresIn: '12h' }
  );
}

function login(username, password) {
  const user = findByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw new HttpError(401, '用户名或密码错误');
  }
  return { token: buildToken(user), user: safeUser(user) };
}

function safeUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

function buildWechatAuthorizeUrl() {
  if (!env.wxAppId || !env.wxRedirectUri) return '';
  const redirect = encodeURIComponent(env.wxRedirectUri);
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${env.wxAppId}&redirect_uri=${redirect}&response_type=code&scope=snsapi_userinfo&state=settlement#wechat_redirect`;
}

async function fetchWechatAccessToken(code) {
  const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${env.wxAppId}&secret=${env.wxSecret}&code=${code}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new HttpError(401, data.errmsg || '微信code换取token失败');
  return data;
}

async function fetchWechatUserInfo(accessToken, openid) {
  const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}&lang=zh_CN`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new HttpError(401, data.errmsg || '获取微信用户信息失败');
  return data;
}

async function loginWithWechat(code) {
  if (!env.wxAppId || !env.wxSecret) throw new HttpError(500, '微信OAuth未配置');
  if (!code) throw new HttpError(400, '缺少code参数');

  const tokenData = await fetchWechatAccessToken(code);
  const profile = await fetchWechatUserInfo(tokenData.access_token, tokenData.openid);

  const { user, isNew } = upsertWechatUser({
    openid: tokenData.openid,
    unionid: tokenData.unionid || null,
    name: profile.nickname || `微信用户${tokenData.openid.slice(-6)}`,
  });

  return { token: buildToken(user), user: safeUser(user), isNew };
}

module.exports = { login, loginWithWechat, buildWechatAuthorizeUrl, buildToken, safeUser };
