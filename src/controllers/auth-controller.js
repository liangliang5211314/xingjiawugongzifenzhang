const { login, loginWithWechat, buildWechatAuthorizeUrl, safeUser } = require('../services/auth-service');
const { findById } = require('../models/user-model');
const { getTeamById } = require('../models/team-model');

function loginController(req, res, next) {
  try {
    const result = login(req.body.username, req.body.password);
    res.json({ ok: true, data: result });
  } catch (e) { next(e); }
}

function meController(req, res, next) {
  try {
    const user = findById(req.user.id);
    const team = user.team_id ? getTeamById(user.team_id) : null;
    res.json({ ok: true, data: { user: safeUser(user), team } });
  } catch (e) { next(e); }
}

function wechatStartController(req, res) {
  const url = buildWechatAuthorizeUrl();
  if (!url) return res.status(500).json({ ok: false, message: '微信OAuth未配置' });
  res.redirect(url);
}

async function wechatCallbackController(req, res, next) {
  try {
    const { code } = req.query;
    const { token } = await loginWithWechat(code);
    res.redirect(`/h5/home#token=${token}`);
  } catch (e) { next(e); }
}

module.exports = { loginController, meController, wechatStartController, wechatCallbackController };
