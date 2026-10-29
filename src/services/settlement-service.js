const { getTeamById } = require('../models/team-model');
const { listUsers } = require('../models/user-model');
const { getRecordsByTeamAndMonth, sumIncomeByTeamMonth, sumIncomeByPersonMonth, getPersonNames } = require('../models/record-model');
const { getSettlement, getSettlementById, listSettlements, saveSettlement, markPushed, getMonthTotalIncome } = require('../models/settlement-model');
const { HttpError } = require('../utils/http-error');
const { fromCents } = require('../utils/money');
const { calculateSettlement } = require('../utils/settlement');

// 获取年同比数据（优先从settlements，否则从income_records聚合）
function fetchYearCompare(teamId, month) {
  const [year, mon] = month.split('-');
  const lastYear  = `${Number(year) - 1}-${mon}`;
  const prev2Year = `${Number(year) - 2}-${mon}`;
  const prev3Year = `${Number(year) - 3}-${mon}`;

  const fromSettlements = (m) => getMonthTotalIncome(teamId, m);
  const fromRecords = (m) => sumIncomeByTeamMonth(teamId, m);

  const last  = fromSettlements(lastYear)  ?? fromRecords(lastYear);
  const prev2 = fromSettlements(prev2Year) ?? fromRecords(prev2Year);
  const prev3 = fromSettlements(prev3Year) ?? fromRecords(prev3Year);
  return { last, prev2, prev3 };
}

function buildSettlementData(teamId, month) {
  const team = getTeamById(teamId);
  if (!team) throw new HttpError(404, '团队不存在');

  const records = getRecordsByTeamAndMonth(teamId, month);
  if (records.length === 0) throw new HttpError(400, '该团队该月没有数据，请先录入');

  const personNames = [...new Set(records.map(r => r.person_name))];

  // 构建京粉账户映射：成员名 -> jd_account（无则回退为成员名，行为与原来完全一致）
  const users = listUsers({ teamId });
  const jdAccountMap = {};
  users.forEach(u => { if (u.name) jdAccountMap[u.name] = u.jd_account || u.name; });

  const result = calculateSettlement(team, personNames, records, jdAccountMap);
  result.month = month;

  const totalIncomeCents  = records.filter(r => r.item_type === 'income').reduce((s, r) => s + r.amount, 0);
  const expenseRecords = records.filter(r => r.item_type === 'expense');
  const totalExpenseCents = expenseRecords.reduce((s, r) => s + Math.abs(r.amount), 0);
  result.expense_items = expenseRecords.map(r => ({
    item_name: r.item_name || '未命名支出',
    amount: fromCents(Math.abs(r.amount)),
    payer_name: r.payer_name || '',
    note: r.note || '',
  }));

  const { last, prev2, prev3 } = fetchYearCompare(teamId, month);

  // 成员个人同月收入历史对比
  const [year, mon] = month.split('-');
  const memberCompare = {
    last:  sumIncomeByPersonMonth(teamId, `${Number(year) - 1}-${mon}`),
    prev2: sumIncomeByPersonMonth(teamId, `${Number(year) - 2}-${mon}`),
    prev3: sumIncomeByPersonMonth(teamId, `${Number(year) - 3}-${mon}`),
  };
  result.member_compare = memberCompare;

  return {
    total_income:        totalIncomeCents,
    total_expense:       totalExpenseCents,
    year_compare_last:   last  ?? null,
    year_compare_prev2:  prev2 ?? null,
    year_compare_prev3:  prev3 ?? null,
    result,
  };
}

function previewSettlement(teamId, month) {
  const { result, ...totals } = buildSettlementData(teamId, month);
  return { team_id: teamId, month, ...totals, result_json: result };
}

let settlementSaved;
function setSettlementSavedHandler(handler){settlementSaved=handler;}
function runSettlement(teamId, month,{notify=true}={}) {
  const saved=saveSettlement(teamId, month, buildSettlementData(teamId, month));
  try{if(notify)settlementSaved?.(saved);}catch(error){console.error('[settlement-review]',error.name);}
  return saved;
}

function fetchSettlement(teamId, month) {
  const s = getSettlement(teamId, month);
  if (!s) throw new HttpError(404, '结算记录不存在，请先运行结算');
  return s;
}

function fetchSettlementById(id) {
  const s = getSettlementById(id);
  if (!s) throw new HttpError(404, '结算记录不存在');
  return s;
}

function getSettlements({ teamId, teamIds, month } = {}) {
  return listSettlements({ teamId, teamIds, month });
}

function markSettlementPushed(id) {
  return markPushed(id);
}

module.exports = { runSettlement, previewSettlement, fetchSettlement, fetchSettlementById, getSettlements, markSettlementPushed,setSettlementSavedHandler };
