const { getTeamById } = require('../models/team-model');
const {
  createRecord, updateRecord, deleteRecord,
  getRecordById, listRecords, getRecordsByTeamAndMonth,
  getYearStats, getMonthStats
} = require('../models/record-model');
const { HttpError } = require('../utils/http-error');
const { toCents, fromCents } = require('../utils/money');

function addRecord({ team_id, month, person_name, item_type, item_name, amount, payer_name, note, created_by }) {
  if (!getTeamById(team_id)) throw new HttpError(404, '团队不存在');
  if (!month || !person_name || !item_type) throw new HttpError(400, '缺少必填字段');
  return createRecord({
    team_id, month, person_name, item_type,
    item_name: item_name || item_type,
    amount: toCents(amount),
    payer_name, note, created_by
  });
}

function editRecord(id, fields) {
  const record = getRecordById(id);
  if (!record) throw new HttpError(404, '记录不存在');
  if (fields.amount !== undefined) fields.amount = toCents(fields.amount);
  return updateRecord(id, fields);
}

function removeRecord(id) {
  if (!getRecordById(id)) throw new HttpError(404, '记录不存在');
  deleteRecord(id);
}

function getRecords({ teamId, month } = {}) {
  const rows = listRecords({ teamId, month });
  return rows.map(r => ({ ...r, amount: fromCents(r.amount) }));
}

function getTeamMonthRecords(teamId, month) {
  if (!teamId || !month) throw new HttpError(400, 'team_id和month不能为空');
  return getRecordsByTeamAndMonth(teamId, month);
}

function getStats(type) {
  const rows = type === 'year' ? getYearStats() : getMonthStats();
  return rows.map(r => ({
    ...r,
    income:  fromCents(r.income_cents  || 0),
    expense: fromCents(r.expense_cents || 0),
    tax:     fromCents(r.tax_cents     || 0),
  }));
}

module.exports = { addRecord, editRecord, removeRecord, getRecords, getTeamMonthRecords, getStats };
