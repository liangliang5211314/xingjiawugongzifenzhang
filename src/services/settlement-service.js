const { getTeamById } = require("../models/team-model");
const { getMembersByTeamId } = require("../models/member-model");
const { getRecordsByTeamAndMonth } = require("../models/record-model");
const { getSettlement, saveSettlement } = require("../models/settlement-model");
const { HttpError } = require("../utils/http-error");
const { calculateSettlement } = require("../utils/settlement");

function settle(teamId, month) {
  const team = getTeamById(teamId);
  if (!team) {
    throw new HttpError(404, "Team not found");
  }

  const members = getMembersByTeamId(teamId);
  if (members.length === 0) {
    throw new HttpError(400, "Team has no members");
  }

  const records = getRecordsByTeamAndMonth(teamId, month);
  if (records.length === 0) {
    throw new HttpError(400, "No records found for the given team and month");
  }

  const result = calculateSettlement(team, members, records);
  result.month = month;
  return saveSettlement(teamId, month, result);
}

function fetchSettlement(teamId, month) {
  const result = getSettlement(teamId, month);
  if (!result) {
    throw new HttpError(404, "Settlement not found");
  }
  return result;
}

module.exports = {
  settle,
  fetchSettlement
};
