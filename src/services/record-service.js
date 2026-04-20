const { getTeamById } = require("../models/team-model");
const { createRecord, getRecordsByTeamAndMonth, getMonthStats, getYearStats } = require("../models/record-model");
const { memberBelongsToTeam } = require("../models/member-model");
const { requireMember } = require("./member-service");
const { HttpError } = require("../utils/http-error");
const { toCents, fromCents } = require("../utils/money");

function addRecord(payload) {
  const team = getTeamById(payload.team_id);
  if (!team) {
    throw new HttpError(404, "Team not found");
  }

  const member = requireMember(payload.member_id);
  if (!memberBelongsToTeam(member.id, Number(payload.team_id))) {
    throw new HttpError(400, "Member does not belong to the given team");
  }

  return {
    ...createRecord({
      ...payload,
      amount: toCents(payload.amount)
    }),
    amount: Number(payload.amount)
  };
}

function listStats(type) {
  const rows = type === "year" ? getYearStats() : getMonthStats();
  return rows.map((row) => ({
    ...row,
    income: fromCents(row.income_cents || 0),
    expense: fromCents(row.expense_cents || 0),
    tax: fromCents(row.tax_cents || 0)
  }));
}

function getTeamMonthRecords(teamId, month) {
  if (!teamId || !month) {
    throw new HttpError(400, "team_id and month are required");
  }
  return getRecordsByTeamAndMonth(teamId, month);
}

module.exports = {
  addRecord,
  listStats,
  getTeamMonthRecords
};
