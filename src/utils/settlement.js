const { fromCents, roundShare } = require('./money');
const { getRuleMembers } = require('../models/team-rule-member-model');
const { HttpError } = require('./http-error');

function evalFormula(formula, vars) {
  try {
    const fn = new Function('income', 'tax', 'expense', 'adjust', 'distributable',
      'return (' + formula + ')');
    const result = fn(vars.income, vars.tax, vars.expense, vars.adjust, vars.distributable);
    return typeof result === 'number' && isFinite(result) ? Math.round(result) : 0;
  } catch (e) { return 0; }
}

function calcFromRuleMembers(ruleMembers, personNames, vars) {
  const result = new Map();
  const ruleMap = new Map(ruleMembers.map(m => [m.member_name, m]));
  personNames.forEach(name => {
    const rm = ruleMap.get(name);
    if (!rm) { result.set(name, 0); return; }
    let share = 0;
    if (rm.rule_mode === 'formula' && rm.formula) {
      share = evalFormula(rm.formula, vars);
    } else if (rm.ratio != null) {
      share = roundShare(vars.distributable, Number(rm.ratio));
    }
    result.set(name, share);
  });
  return result;
}

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
  // 最终参与分账的成员名单（公式模式下会扩充）
  let finalPersonNames = [...personNames];

  const ruleMembers = team.id ? getRuleMembers(team.id) : [];
  if (ruleMembers.length > 0) {
    // ── 成员公式模式 ──────────────────────────────────────────────
    // 完全忽略 zteam / standard 旧逻辑，不做 expense 二次报销补偿
    // 以 team_rule_members 为权威成员名单，补充进 finalPersonNames
    ruleMembers.forEach(m => {
      if (!finalPersonNames.includes(m.member_name)) finalPersonNames.push(m.member_name);
    });

    const vars = {
      income:       totalIncomeCents,
      tax:          totalTaxCents,
      expense:      totalExpenseCents,
      adjust:       totalAdjustCents,
      distributable: distributableCents,
    };
    shouldGetMap = calcFromRuleMembers(ruleMembers, finalPersonNames, vars);

    // 校验1：所有成员 should_get 之和必须 ≈ total_income（允许 n 分舍入误差）
    const totalShouldGet = [...shouldGetMap.values()].reduce((s, v) => s + v, 0);
    if (Math.abs(totalShouldGet - totalIncomeCents) > finalPersonNames.length) {
      throw new HttpError(400,
        `成员公式分配总和 ¥${fromCents(totalShouldGet)} ≠ 总收入 ¥${fromCents(totalIncomeCents)}，请检查各成员公式`);
    }

    // 校验2：有公式但结果为 0，说明公式写错
    const ruleMap = new Map(ruleMembers.map(m => [m.member_name, m]));
    for (const [name, share] of shouldGetMap) {
      const rm = ruleMap.get(name);
      if (rm && rm.rule_mode === 'formula' && rm.formula && share === 0) {
        throw new HttpError(400,
          `成员「${name}」公式计算结果为 0，请确认公式正确：${rm.formula}`);
      }
    }

  } else if (team.rule_type === 'zteam') {
    // zteam: should_get 里已含 leader 报销；sum(should_get) = income - tax + adjust
    shouldGetMap = calcZteam(team, finalPersonNames, totalIncomeCents, totalTaxCents, totalExpenseCents, totalAdjustCents);
  } else {
    // standard/custom: distributable 已扣除 expense；再逐条把 expense 还给实际垫付人
    shouldGetMap = calcStandard(team, finalPersonNames, distributableCents);
    records.filter(r => r.item_type === 'expense').forEach(r => {
      const amt = Math.abs(r.amount);
      shouldGetMap.set(r.person_name, (shouldGetMap.get(r.person_name) || 0) + amt);
    });
  }

  // actual = 每人实收（income+, tax-, adjust±；expense 不计入 actual）
  const actualMap = new Map(finalPersonNames.map(n => [n, 0]));
  records.forEach(r => {
    if (r.item_type === 'expense') return;
    const sign = (r.item_type === 'income' || r.item_type === 'adjust') ? 1 : -1;
    actualMap.set(r.person_name, (actualMap.get(r.person_name) || 0) + sign * Math.abs(r.amount));
  });

  const memberSettlements = finalPersonNames.map(name => {
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
