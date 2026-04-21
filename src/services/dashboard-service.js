const { db } = require('../config/database');
const { fromCents } = require('../utils/money');
const { getAllTeams } = require('../models/team-model');

// 当前月份 YYYY-MM
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function prevMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function currentYear() {
  return new Date().getFullYear().toString();
}

function lastYear() {
  return (new Date().getFullYear() - 1).toString();
}

function sumIncome(month) {
  const row = db.prepare(
    "SELECT SUM(amount) AS total FROM income_records WHERE item_type='income' AND month=?"
  ).get(month);
  return row?.total || 0;
}

function sumIncomeYear(year) {
  const row = db.prepare(
    "SELECT SUM(amount) AS total FROM income_records WHERE item_type='income' AND substr(month,1,4)=?"
  ).get(year);
  return row?.total || 0;
}

function getTeamMonthIncome(month) {
  return db.prepare(`
    SELECT t.id, t.name, COALESCE(SUM(r.amount),0) AS income_cents
    FROM teams t
    LEFT JOIN income_records r ON r.team_id = t.id AND r.item_type='income' AND r.month=?
    WHERE t.status=1
    GROUP BY t.id
  `).all(month);
}

function getDashboard() {
  const cm = currentMonth();
  const pm = prevMonth();
  const cy = currentYear();
  const ly = lastYear();

  const teams = getAllTeams().filter(t => t.status !== 0);

  return {
    current_month:      cm,
    this_month_income:  fromCents(sumIncome(cm)),
    last_month_income:  fromCents(sumIncome(pm)),
    this_year_income:   fromCents(sumIncomeYear(cy)),
    last_year_income:   fromCents(sumIncomeYear(ly)),
    team_count:         teams.length,
    team_overview:      getTeamMonthIncome(cm).map(r => ({
      id:   r.id,
      name: r.name,
      this_month_income: fromCents(r.income_cents),
    })),
  };
}

module.exports = { getDashboard };
