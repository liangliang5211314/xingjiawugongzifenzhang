const { login, loginWithWechat, buildWechatAuthorizeUrl, safeUser } = require('../services/auth-service');
const { findById } = require('../models/user-model');
const { getTeamById, getTeamsByLeaderUserId } = require('../models/team-model');

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
    const leaderTeams = getTeamsByLeaderUserId(user.id);
    res.json({
      ok: true,
      data: {
        user: safeUser(user),
        team,
        leader_teams: leaderTeams,
        can_manage_admin: user.role === 'admin' || leaderTeams.length > 0,
      }
    });
  } catch (e) { next(e); }
}

function wechatStartController(req, res) {
  const url = buildWechatAuthorizeUrl();
  if (!url) return res.status(500).json({ ok: false, message: '微信 OAuth 未配置' });
  res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>性价屋分成结算系统</title>
  <style>
    body{margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}
    .logo{font-size:22px;font-weight:700;color:#4a5aef;margin-bottom:12px}
    .tip{font-size:14px;color:#888}
    .spinner{width:32px;height:32px;border:3px solid #e0e4ff;border-top-color:#4a5aef;border-radius:50%;animation:spin .8s linear infinite;margin:20px auto 0}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="logo">性价屋分成结算系统</div>
  <div class="tip">正在跳转微信授权...</div>
  <div class="spinner"></div>
  <script>location.replace(${JSON.stringify(url)});</script>
</body>
</html>`);
}

async function wechatCallbackController(req, res, next) {
  try {
    const { code } = req.query;
    const { token } = await loginWithWechat(code);
    res.redirect(`/h5/home#token=${token}`);
  } catch (e) { next(e); }
}

module.exports = { loginController, meController, wechatStartController, wechatCallbackController };
