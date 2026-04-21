const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { HttpError } = require('../utils/http-error');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return next(new HttpError(401, '需要登录'));
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch {
    return next(new HttpError(401, 'Token无效或已过期'));
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, '需要登录'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, '权限不足'));
    return next();
  };
}

// 成员只能访问自己所属团队；admin可访问所有
function ensureTeamAccess(req, res, next) {
  if (req.user.role === 'admin') return next();

  const teamId = Number(
    req.params.teamId || req.query.team_id || req.body?.team_id
  );

  if (!teamId || teamId !== Number(req.user.team_id)) {
    return next(new HttpError(403, '只能访问自己所属的团队'));
  }
  return next();
}

module.exports = { authenticate, authorize, ensureTeamAccess };
