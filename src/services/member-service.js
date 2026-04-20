const { getTeamById } = require("../models/team-model");
const { createMember, getMemberById, getMembersByTeamId } = require("../models/member-model");
const { HttpError } = require("../utils/http-error");

function listMembers(teamId) {
  if (!teamId) {
    throw new HttpError(400, "team_id is required");
  }
  return getMembersByTeamId(teamId);
}

function addMember(payload) {
  const team = getTeamById(payload.team_id);
  if (!team) {
    throw new HttpError(404, "Team not found");
  }
  return createMember(payload);
}

function requireMember(id) {
  const member = getMemberById(id);
  if (!member) {
    throw new HttpError(404, "Member not found");
  }
  return member;
}

module.exports = {
  listMembers,
  addMember,
  requireMember
};
