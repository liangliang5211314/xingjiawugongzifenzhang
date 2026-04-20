const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { getUserByUsername } = require("../models/user-model");
const { getTeamById } = require("../models/team-model");
const { HttpError } = require("../utils/http-error");

function login(username, password) {
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    throw new HttpError(401, "Invalid username or password");
  }

  const token = jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      team_id: user.team_id
    },
    env.jwtSecret,
    { expiresIn: "12h" }
  );

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      team_id: user.team_id
    }
  };
}

function getProfile(authUser) {
  return {
    user: authUser,
    team: authUser.team_id ? getTeamById(authUser.team_id) : null
  };
}

module.exports = { login, getProfile };
