const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { getAccessibleTeamIdsForUser } = require("../models/user-team-model");
const { HttpError } = require("../utils/http-error");

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return next(new HttpError(401, "Authentication required"));
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch (error) {
    return next(new HttpError(401, "Invalid token"));
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new HttpError(401, "Authentication required"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, "Permission denied"));
    }
    return next();
  };
}

function ensureTeamAccess(req, res, next) {
  if (req.user.role === "admin") {
    return next();
  }

  const teamId = Number(
    req.params.teamId ||
      req.query.team_id ||
      req.body.team_id ||
      req.body.teamId
  );

  const accessibleTeamIds = getAccessibleTeamIdsForUser(req.user) || [];
  if (!teamId || !accessibleTeamIds.includes(Number(teamId))) {
    return next(new HttpError(403, "You can only access your own team"));
  }

  return next();
}

module.exports = {
  authenticate,
  authorize,
  ensureTeamAccess
};
