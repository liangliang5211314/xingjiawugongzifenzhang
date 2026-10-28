const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');

// Exercise the real rule model and settlement engine without opening project data.
process.env.DB_PATH = ':memory:';
const { db } = require('../src/config/database');
db.exec('CREATE TABLE teams (id INTEGER PRIMARY KEY); INSERT INTO teams (id) VALUES (1)');
const { setRuleMembers } = require('../src/models/team-rule-member-model');
const { calculateSettlement } = require('../src/utils/settlement');

const team = { id: 1, name: '性价屋Z团队', rule_type: 'custom', rule_config: { allocations: [] } };
const equalShare = '(income-round(income*0.2)-expense)/3 + paid_expense';
const rules = [
  { member_name: '崔海亮', rule_mode: 'formula', formula: equalShare },
  { member_name: '张明亮', rule_mode: 'formula', formula: 'round(income*0.2) + paid_expense' },
  { member_name: '崔如意', rule_mode: 'formula', formula: equalShare },
  { member_name: '崔紫阳', rule_mode: 'formula', formula: equalShare },
];
const october = [
  { person_name: '崔如意', item_type: 'income', amount: 1065729 },
  { person_name: '崔海亮', item_type: 'income', amount: 42 },
  { person_name: '崔紫阳', item_type: 'income', amount: 85992 },
  { person_name: '张明亮', item_type: 'expense', amount: -108000, payer_name: '张明亮' },
  { person_name: '崔海亮', item_type: 'expense', amount: -52800, payer_name: '崔海亮' },
];

beforeEach(() => setRuleMembers(team.id, rules));
after(() => db.close());

function calculate(records = october) {
  return calculateSettlement(team, [...new Set(records.map(r => r.person_name))], records);
}

function cents(value) {
  return Math.round(value * 100);
}

function receivables(result) {
  return Object.fromEntries(result.members.map(m => [m.name, cents(m.should_get)]));
}

function assertBalanced(result) {
  assert.equal(result.members.reduce((sum, m) => sum + cents(m.should_get), 0), cents(result.total_income));
  result.members.forEach(m => {
    const incoming = result.transfers.filter(t => t.to === m.name).reduce((sum, t) => sum + cents(t.amount), 0);
    const outgoing = result.transfers.filter(t => t.from === m.name).reduce((sum, t) => sum + cents(t.amount), 0);
    assert.equal(cents(m.actual) + incoming - outgoing, cents(m.should_get), m.name);
  });
}

test('October splits expenses among the three members and reimburses each actual payer', () => {
  const result = calculate();
  assert.equal(result.total_expense, 1608);
  assert.deepEqual(receivables(result), {
    张明亮: 338353, 崔海亮: 306337, 崔如意: 253537, 崔紫阳: 253536,
  });
  assert.deepEqual(Object.fromEntries(result.transfers.map(t => [t.to, cents(t.amount)])), {
    张明亮: 338353, 崔海亮: 306295, 崔紫阳: 167544,
  });
  assertBalanced(result);
});

test('payer_name takes precedence over the record owner', () => {
  const records = structuredClone(october);
  records[3].payer_name = '崔海亮';
  const result = calculate(records);
  assert.deepEqual(receivables(result), {
    张明亮: 230353, 崔海亮: 414337, 崔如意: 253537, 崔紫阳: 253536,
  });
  assertBalanced(result);
});

test('missing payer_name uses the expense record owner', () => {
  const records = october.map(r => ({ ...r, payer_name: '' }));
  assert.deepEqual(receivables(calculate(records)), receivables(calculate()));
});

test('expenses with mixed storage signs are added by absolute amount', () => {
  const records = structuredClone(october);
  records[4].amount = 52800;
  const result = calculate(records);
  assert.equal(result.total_expense, 1608);
  assert.deepEqual(receivables(result), receivables(calculate()));
  assertBalanced(result);
});

test('rounding pennies follow configured member order rather than record order', () => {
  assert.deepEqual(receivables(calculate([...october].reverse())), receivables(calculate()));
});

test('August remains unchanged when Zhang prepaid all expenses', () => {
  const result = calculate([
    { person_name: '崔紫阳', item_type: 'income', amount: 1178387 },
    { person_name: '崔海亮', item_type: 'income', amount: 2036 },
    { person_name: '崔如意', item_type: 'income', amount: 1450 },
    { person_name: '张明亮', item_type: 'expense', amount: -108000, payer_name: '张明亮' },
  ]);
  assert.deepEqual(receivables(result), {
    张明亮: 344375, 崔海亮: 279166, 崔如意: 279166, 崔紫阳: 279166,
  });
  assertBalanced(result);
});

test('no expenses produces no reimbursement and still settles every penny', () => {
  const result = calculate([{ person_name: '崔如意', item_type: 'income', amount: 10000 }]);
  assert.deepEqual(receivables(result), {
    张明亮: 2000, 崔海亮: 2667, 崔如意: 2667, 崔紫阳: 2666,
  });
  assertBalanced(result);
});

test('invalid formula totals remain an error rather than silently redistributing money', () => {
  setRuleMembers(team.id, rules.map(r => r.member_name === '张明亮'
    ? { ...r, formula: 'income*0.3 + paid_expense' }
    : r));
  assert.throws(() => calculate(), /成员公式分配总和/);
});
