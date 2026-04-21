const { fromCents, roundShare } = require('./money');

// 将最少转账路径计算出来（贪心算法）
function buildTransfers(memberSettlements) {
  const debtors   = [];
  const creditors = [];

  memberSettlements.forEach(m => {
    if (m.diff_cents < 0) debtors.push({ name: m.name, amount: Math.abs(m.diff_cents) });
    else if (m.diff_cents > 0) creditors.push({ name: m.name, amount: m.diff_cents });
  });

  const transfers = [];
  let di = 0, ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di];
    const c = creditors[ci];
    const amount = Math.min(d.amount, c.amount);
    transfers.push({ from: d.name, to: c.name, amount: fromCents(amount) });
    d.amount -= amount;
    c.amount -= amount;
    if (d.amount === 0) di++;
    if (c.amount === 0) ci++;
  }
  return transfers;
}

function splitEvenly(totalCents, count) {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

// standard规则：leader拿比例，其余平分
function calcStandard(team, personNames, distributableCents) {
  const config = team.rule_config || {};
  const result = new Map();

  // custom分配：rule_config.allocations = [{name, ratio}]
  if (config.strategy === 'fixed-ratios' || team.rule_type === 'custom') {
    const allocations = Array.isArray(config.allocations) ? config.allocations : [];
    const ratioMap = new Map(allocations.map(a => [a.name, Number(a.ratio || 0)]));
    let assigned = 0;
    const raw = personNames.map(name => {
      const share = roundShare(distributableCents, ratioMap.get(name) || 0);
      assigned += share;
      return { name, share };
    });
    const delta = distributableCents - assigned;
    if (raw.length > 0) raw[raw.length - 1].share += delta;
    raw.forEach(({ name, share }) => result.set(name, share));
    return result;
  }

  // 默认：leader-plus-equal
  const leaderRatio = Number(config.leader_ratio ?? 0.2);
  const leaderName = config.leader_name || null;
  const leaderShare = leaderName ? roundShare(distributableCents, leaderRatio) : 0;
  const others = personNames.filter(n => n !== leaderName);
  const remaining = distributableCents - leaderShare;
  const equalShares = splitEvenly(remaining, others.length);

  personNames.forEach(name => {
    if (name === leaderName) { result.set(name, leaderShare); return; }
    result.set(name, equalShares[others.indexOf(name)] || 0);
  });

  if (!leaderName && personNames.length > 0) {
    const fallback = splitEvenly(distributableCents, personNames.length);
    personNames.forEach((name, i) => result.set(name, fallback[i]));
  }
  return result;
}

// zteam规则：leader = 总收入×ratio + 报销；其余平分剩余
function calcZteam(team, personNames, totalIncomeCents, totalTaxCents, totalExpenseCents, totalAdjustCents) {
  const config = team.rule_config || {};
  const leaderName = config.leader_name || '';
  const leaderRatio = Number(config.leader_ratio ?? 0.2);
  const reimburse = config.reimburse_expenses !== false;
  const result = new Map();

  const hasLeader = personNames.includes(leaderName);
  if (!hasLeader) {
    const dist = totalIncomeCents - totalTaxCents + totalAdjustCents;
    return calcStandard(team, personNames, dist);
  }

  const others = personNames.filter(n => n !== leaderName);
  const basePool = roundShare(totalIncomeCents, leaderRatio);
  const leaderGet = basePool + (reimburse ? totalExpenseCents : 0);
  const otherPool = totalIncomeCents - basePool - totalExpenseCents - totalTaxCents + totalAdjustCents;
  const otherShares = splitEvenly(otherPool, others.length);

  result.set(leaderName, leaderGet);
  others.forEach((name, i) => result.set(name, otherShares[i] || 0));
  return result;
}

/**
 * 核心结算函数
 * @param {object} team - { id, name, rule_type, rule_config }
 * @param {string[]} personNames - 参与分账的成员姓名数组
 * @param {object[]} records - income_records 行，字段: person_name, item_type, amount
 * @returns {object} 结算结果
 */
function calculateSettlement(team, personNames, records) {
  const sum = (type) => records.filter(r => r.item_type === type).reduce((s, r) => s + r.amount, 0);

  const totalIncomeCents  = sum('income');
  const totalTaxCents     = sum('tax');
  const totalExpenseCents = Math.abs(sum('expense')); // 支出存为负数或正数均兼容
  const totalAdjustCents  = sum('adjust');
  const distributableCents = totalIncomeCents - totalTaxCents - totalExpenseCents + totalAdjustCents;

  let shouldGetMap;
  if (team.rule_type === 'zteam') {
    // zteam: should_get 里已含 leader 报销；sum(should_get) = income - tax + adjust
    shouldGetMap = calcZteam(team, personNames, totalIncomeCents, totalTaxCents, totalExpenseCents, totalAdjustCents);
  } else {
    // standard/custom: distributable 已扣除 expense；再逐条把 expense 还给实际垫付人
    shouldGetMap = calcStandard(team, personNames, distributableCents);
    records.filter(r => r.item_type === 'expense').forEach(r => {
      const amt = Math.abs(r.amount);
      shouldGetMap.set(r.person_name, (shouldGetMap.get(r.person_name) || 0) + amt);
    });
  }

  // actual = 每人实收金额（income+、tax-、adjust±；expense不计入actual，通过should_get报销）
  // 这样 sum(actual) = sum(should_get) 保证账面平衡
  const actualMap = new Map(personNames.map(n => [n, 0]));
  records.forEach(r => {
    if (r.item_type === 'expense') return; // expense 不进 actual
    const sign = (r.item_type === 'income' || r.item_type === 'adjust') ? 1 : -1;
    actualMap.set(r.person_name, (actualMap.get(r.person_name) || 0) + sign * Math.abs(r.amount));
  });

  const memberSettlements = personNames.map(name => {
    const shouldGet = shouldGetMap.get(name) || 0;
    const actual    = actualMap.get(name) || 0;
    const diff      = shouldGet - actual;
    return {
      name,
      should_get:       fromCents(shouldGet),
      actual:           fromCents(actual),
      diff:             fromCents(diff),
      diff_cents:       diff,
    };
  });

  return {
    team_id:       team.id,
    team_name:     team.name,
    rule_type:     team.rule_type,
    total_income:  fromCents(totalIncomeCents),
    total_tax:     fromCents(totalTaxCents),
    total_expense: fromCents(totalExpenseCents),
    total_adjust:  fromCents(totalAdjustCents),
    distributable: fromCents(distributableCents),
    members:       memberSettlements.map(({ diff_cents, ...rest }) => rest),
    transfers:     buildTransfers(memberSettlements),
  };
}

module.exports = { calculateSettlement };
