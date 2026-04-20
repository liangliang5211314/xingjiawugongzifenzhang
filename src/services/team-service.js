const bcrypt = require("bcryptjs");
const { addUserToTeams, createUser } = require("../models/user-model");
const { createTeam, getAllTeams, getTeamById, getTeamByName, getTeamsByIds, updateTeam } = require("../models/team-model");
const { getAccessibleTeamIdsForUser } = require("../models/user-team-model");
const { HttpError } = require("../utils/http-error");

function normalizeRuleConfig(payload) {
  const ruleType = payload.rule_type;
  const ruleConfig = payload.rule_config || {};

  if (ruleType === "zteam") {
    return {
      leader_member_name: ruleConfig.leader_member_name || "张明亮",
      leader_ratio: Number(ruleConfig.leader_ratio ?? 0.2),
      reimburse_expenses: ruleConfig.reimburse_expenses !== false
    };
  }

  if (ruleType === "standard") {
    return {
      strategy: ruleConfig.strategy || "leader-plus-equal",
      leader_member_id: ruleConfig.leader_member_id || null,
      leader_ratio: Number(ruleConfig.leader_ratio ?? 0.2)
    };
  }

  if (ruleType === "custom") {
    return {
      strategy: ruleConfig.strategy || "fixed-ratios",
      allocations: Array.isArray(ruleConfig.allocations) ? ruleConfig.allocations : []
    };
  }

  throw new HttpError(400, "Unsupported rule_type");
}

function normalizeTeamPayload(payload, existingTeamId = null) {
  if (!payload.name) {
    throw new HttpError(400, "Team name is required");
  }

  const duplicate = getTeamByName(payload.name);
  if (duplicate && Number(duplicate.id) !== Number(existingTeamId)) {
    throw new HttpError(409, "Team name already exists");
  }

  return {
    name: payload.name,
    rule_type: payload.rule_type || "standard",
    rule_config: normalizeRuleConfig(payload)
  };
}

function listTeams(user) {
  if (!user || user.role === "admin") {
    return getAllTeams();
  }
  const teamIds = getAccessibleTeamIdsForUser(user);
  return getTeamsByIds(teamIds);
}

function createTeamWithOptionalUser(payload) {
  const teamPayload = normalizeTeamPayload(payload);
  const team = createTeam(teamPayload);

  if (payload.user && payload.user.username && payload.user.password) {
    const createdUser = createUser({
      username: payload.user.username,
      password: bcrypt.hashSync(payload.user.password, 10),
      role: "team_user",
      team_id: team.id
    });
    addUserToTeams(createdUser.id, [team.id]);
  }

  return team;
}

function updateExistingTeam(teamId, payload) {
  const existing = getTeamById(teamId);
  if (!existing) {
    throw new HttpError(404, "Team not found");
  }
  return updateTeam(teamId, normalizeTeamPayload(payload, teamId));
}

module.exports = {
  listTeams,
  createTeamWithOptionalUser,
  updateExistingTeam
};
