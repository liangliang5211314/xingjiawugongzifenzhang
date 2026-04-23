const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { getTeamsByLeaderUserId } = require('../models/team-model');
const { HttpError } = require('../utils/http-error');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return next(new HttpError(401, '需要登录'));
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    const managedTeamIds = getTeamsByLeaderUserId(req.user.id).map(t => t.id);
    req.user.managed_team_ids = managedTeamIds;
    req.user.is_team_leader = managedTeamIds.length > 0;
    return next();
  } catch {
    return next(new HttpError(401, 'Token 无效或已过期'));
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, '需要登录'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, '权限不足'));
    return next();
  };
}

function authorizeAdminOrLeader(req, res, next) {
  if (!req.user) return next(new HttpError(401, '需要登录'));
  if (req.user.role === 'admin' || req.user.is_team_leader) return next();
  return next(new HttpError(403, '权限不足'));
}

function canManageTeam(user, teamId) {
  if (!teamId) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.managed_team_ids) && user.managed_team_ids.includes(Number(teamId));
}

function assertCanManageTeam(user, teamId) {
  if (canManageTeam(user, teamId)) return;
  throw new HttpError(403, '只能操作自己负责的团队');
}

module.exports = { authenticate, authorize, authorizeAdminOrLeader, canManageTeam, assertCanManageTeam };
