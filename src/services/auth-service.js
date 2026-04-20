const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const {
  createUser,
  getUserByUsername,
  getUserByWxOpenId,
  touchLastLogin,
  updateUserWechatProfile
} = require("../models/user-model");
const { getTeamsByIds } = require("../models/team-model");
const { getAccessibleTeamIdsForUser } = require("../models/user-team-model");
const { HttpError } = require("../utils/http-error");

function buildToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      id: user.id,
      username: user.username,
      role: user.role,
      team_id: user.team_id
    },
    env.jwtSecret,
    { expiresIn: "12h" }
  );
}

function buildUserPayload(user) {
  return {
    id: user.id,
    uid: user.uid || `U${String(user.id).padStart(6, "0")}`,
    username: user.username,
    phone: user.phone || "",
    nickname: user.nickname || user.username,
    avatar: user.avatar_url || "",
    role: user.role,
    bio: user.bio || "",
    region: user.region || "",
    status: user.status || "normal",
    favList: []
  };
}

function buildAuthPayload(user) {
  const lastLogin = new Date().toISOString();
  touchLastLogin(user.id, lastLogin);
  return {
    token: buildToken(user),
    user: buildUserPayload({
      ...user,
      last_login: lastLogin
    })
  };
}

function login(username, password) {
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    throw new HttpError(401, "Invalid username or password");
  }
  return buildAuthPayload(user);
}

function buildWechatAuthorizeUrl() {
  if (!env.wxAppId || !env.wxRedirectUri) {
    return "";
  }
  const redirect = encodeURIComponent(env.wxRedirectUri);
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${env.wxAppId}&redirect_uri=${redirect}&response_type=code&scope=snsapi_userinfo&state=settlement#wechat_redirect`;
}

async function fetchWechatAccessToken(code) {
  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.searchParams.set("appid", env.wxAppId);
  url.searchParams.set("secret", env.wxSecret);
  url.searchParams.set("code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new HttpError(401, data.errmsg || "Failed to exchange WeChat code");
  }
  return data;
}

async function fetchWechatUserInfo(accessToken, openid) {
  const url = new URL("https://api.weixin.qq.com/sns/userinfo");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("openid", openid);
  url.searchParams.set("lang", "zh_CN");

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode) {
    throw new HttpError(401, data.errmsg || "Failed to fetch WeChat user info");
  }
  return data;
}

async function loginWithWechat(code) {
  if (!env.wxAppId || !env.wxSecret) {
    throw new HttpError(500, "WeChat OAuth is not configured");
  }
  if (!code) {
    throw new HttpError(400, "code is required");
  }

  const tokenData = await fetchWechatAccessToken(code);
  const profile = await fetchWechatUserInfo(tokenData.access_token, tokenData.openid);
  const lastLogin = new Date().toISOString();
  const region = [profile.country, profile.province, profile.city].filter(Boolean).join(" ");

  let user = getUserByWxOpenId(tokenData.openid);
  let isNew = false;

  if (!user) {
    user = createUser({
      username: `wx_${tokenData.openid}`,
      password: bcrypt.hashSync(`${tokenData.openid}${env.jwtSecret}`, 8),
      role: "team_user",
      uid: `WX${Date.now()}`,
      phone: "",
      nickname: profile.nickname || `微信用户${tokenData.openid.slice(-6)}`,
      bio: "",
      region,
      status: "normal",
      avatar_url: profile.headimgurl || "",
      wx_openid: tokenData.openid,
      wechat_openid: tokenData.openid,
      wechat_unionid: tokenData.unionid || null,
      last_login: lastLogin
    });
    isNew = true;
  } else {
    user = updateUserWechatProfile(user.id, {
      nickname: profile.nickname || user.nickname,
      avatar_url: profile.headimgurl || user.avatar_url,
      region: region || user.region,
      wx_openid: tokenData.openid,
      wechat_openid: tokenData.openid,
      wechat_unionid: tokenData.unionid || user.wechat_unionid,
      last_login: lastLogin
    });
  }

  return {
    ok: true,
    data: {
      token: buildToken(user),
      isNew,
      user: buildUserPayload(user)
    }
  };
}

function getProfile(authUser) {
  const teamIds = getAccessibleTeamIdsForUser(authUser);
  return {
    user: {
      ...authUser,
      team_ids: teamIds || []
    },
    teams: teamIds === null ? [] : getTeamsByIds(teamIds),
    primary_team: authUser.team_id ? getTeamsByIds([authUser.team_id])[0] || null : null,
    wechat_login: {
      enabled: !!(env.wxAppId && env.wxSecret),
      status: env.wxAppId && env.wxSecret ? "enabled" : "planned",
      message:
        env.wxAppId && env.wxSecret
          ? "已配置微信 OAuth，可在手机端通过微信授权 code 登录。"
          : "第一阶段仅提供微信登录界面预留，暂未接入真实微信 OAuth。",
      authorize_url: buildWechatAuthorizeUrl()
    }
  };
}

module.exports = {
  login,
  loginWithWechat,
  getProfile
};
