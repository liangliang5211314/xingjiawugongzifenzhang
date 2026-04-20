const { getTeamById } = require("../models/team-model");
const { addMemberToTeam, createMember, getMemberById, getMembersByTeamId } = require("../models/member-model");
const { HttpError } = require("../utils/http-error");

function listMembers(teamId) {
  if (!teamId) {
    throw new HttpError(400, "team_id is required");
  }
  return getMembersByTeamId(teamId);
}

function addMember(payload) {
  const teamIds = Array.isArray(payload.team_ids) && payload.team_ids.length > 0
    ? payload.team_ids.map(Number)
    : [Number(payload.team_id)];

  teamIds.forEach((teamId) => {
    const team = getTeamById(teamId);
    if (!team) {
      throw new HttpError(404, `Team ${teamId} not found`);
    }
  });

  const member = createMember({ name: payload.name });
  teamIds.forEach((teamId) => {
    addMemberToTeam({
      member_id: member.id,
      team_id: teamId,
      is_leader: Number(teamId) === Number(teamIds[0]) ? !!payload.is_leader : false
    });
  });
  return member;
}

function addExistingMemberToTeam(memberId, teamId, isLeader = false) {
  const team = getTeamById(teamId);
  if (!team) {
    throw new HttpError(404, "Team not found");
  }
  const member = requireMember(memberId);
  addMemberToTeam({ member_id: member.id, team_id: teamId, is_leader: isLeader });
  return member;
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
  addExistingMemberToTeam,
  requireMember
};
