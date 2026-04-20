const { fromCents, roundShare } = require("./money");

function getSignedRecordAmount(record) {
  if (record.type === "income") {
    return record.amount;
  }
  if (record.type === "adjust") {
    return record.amount;
  }
  return -Math.abs(record.amount);
}

function splitEvenly(totalCents, count) {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function buildTransfers(memberSettlements) {
  const debtors = [];
  const creditors = [];

  memberSettlements.forEach((member) => {
    if (member.diff_cents < 0) {
      debtors.push({ member_id: member.member_id, name: member.name, amount: Math.abs(member.diff_cents) });
    } else if (member.diff_cents > 0) {
      creditors.push({ member_id: member.member_id, name: member.name, amount: member.diff_cents });
    }
  });

  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);

    transfers.push({
      from_member_id: debtor.member_id,
      from_name: debtor.name,
      to_member_id: creditor.member_id,
      to_name: creditor.name,
      amount: fromCents(amount)
    });

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount === 0) {
      debtorIndex += 1;
    }
    if (creditor.amount === 0) {
      creditorIndex += 1;
    }
  }

  return transfers;
}

function calculateStandardShouldGet(team, members, distributableCents) {
  const config = team.rule_config || {};
  const strategy = config.strategy || "leader-plus-equal";

  if (strategy === "fixed-ratios") {
    const ratios = Array.isArray(config.allocations) ? config.allocations : [];
    const ratioMap = new Map(ratios.map((item) => [Number(item.member_id), Number(item.ratio || 0)]));
    const raw = members.map((member) => ({
      member_id: member.id,
      amount: roundShare(distributableCents, ratioMap.get(member.id) || 0)
    }));
    const assigned = raw.reduce((sum, item) => sum + item.amount, 0);
    const delta = distributableCents - assigned;
    if (raw.length > 0) {
      raw[raw.length - 1].amount += delta;
    }
    return new Map(raw.map((item) => [item.member_id, item.amount]));
  }

  const leaderRatio = Number(config.leader_ratio ?? 0.2);
  const leaderId = config.leader_member_id
    ? Number(config.leader_member_id)
    : members.find((member) => member.is_leader)?.id;

  const leaderShare = leaderId ? roundShare(distributableCents, leaderRatio) : 0;
  const others = members.filter((member) => member.id !== leaderId);
  const remaining = distributableCents - leaderShare;
  const equalShares = others.length > 0 ? splitEvenly(remaining, others.length) : [];
  const result = new Map();

  members.forEach((member) => {
    if (member.id === leaderId) {
      result.set(member.id, leaderShare);
      return;
    }
    const index = others.findIndex((item) => item.id === member.id);
    result.set(member.id, equalShares[index] || 0);
  });

  if (!leaderId && members.length > 0) {
    const equalFallback = splitEvenly(distributableCents, members.length);
    members.forEach((member, index) => result.set(member.id, equalFallback[index]));
  }

  return result;
}

function calculateZTeamShouldGet(team, members, totalIncomeCents, totalTaxCents, totalExpenseCents, totalAdjustCents) {
  const config = team.rule_config || {};
  const leaderName = config.leader_member_name || "张明亮";
  const leaderRatio = Number(config.leader_ratio ?? 0.2);
  const reimburseExpenses = config.reimburse_expenses !== false;
  const leader = members.find((member) => member.name === leaderName) || members.find((member) => member.is_leader);
  const result = new Map();

  if (!leader) {
    return calculateStandardShouldGet(team, members, totalIncomeCents - totalTaxCents + totalAdjustCents);
  }

  const others = members.filter((member) => member.id !== leader.id);
  const basePool = roundShare(totalIncomeCents, leaderRatio);
  const leaderShouldGet = basePool + (reimburseExpenses ? totalExpenseCents : 0);
  const otherPool = totalIncomeCents - basePool - totalExpenseCents - totalTaxCents + totalAdjustCents;
  const otherShares = others.length > 0 ? splitEvenly(otherPool, others.length) : [];

  result.set(leader.id, leaderShouldGet);
  others.forEach((member, index) => {
    result.set(member.id, otherShares[index] || 0);
  });

  return result;
}

function calculateSettlement(team, members, records) {
  const totalIncomeCents = records.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  const totalTaxCents = records.filter((item) => item.type === "tax").reduce((sum, item) => sum + item.amount, 0);
  const totalExpenseCents = records.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  const totalAdjustCents = records.filter((item) => item.type === "adjust").reduce((sum, item) => sum + item.amount, 0);
  const distributableCents = totalIncomeCents - totalTaxCents - totalExpenseCents + totalAdjustCents;

  let shouldGetMap;
  if (team.rule_type === "zteam") {
    shouldGetMap = calculateZTeamShouldGet(
      team,
      members,
      totalIncomeCents,
      totalTaxCents,
      totalExpenseCents,
      totalAdjustCents
    );
  } else {
    shouldGetMap = calculateStandardShouldGet(team, members, distributableCents);
  }

  const actualMap = new Map(members.map((member) => [member.id, 0]));
  records.forEach((record) => {
    actualMap.set(record.member_id, (actualMap.get(record.member_id) || 0) + getSignedRecordAmount(record));
  });

  const memberSettlements = members.map((member) => {
    const shouldGet = shouldGetMap.get(member.id) || 0;
    const actual = actualMap.get(member.id) || 0;
    const diff = shouldGet - actual;
    return {
      member_id: member.id,
      name: member.name,
      should_get: fromCents(shouldGet),
      actual: fromCents(actual),
      diff: fromCents(diff),
      should_get_cents: shouldGet,
      actual_cents: actual,
      diff_cents: diff
    };
  });

  return {
    team_id: team.id,
    team_name: team.name,
    month: records[0]?.month || null,
    rule_type: team.rule_type,
    total_income: fromCents(totalIncomeCents),
    total_tax: fromCents(totalTaxCents),
    total_expense: fromCents(totalExpenseCents),
    total_adjust: fromCents(totalAdjustCents),
    distributable: fromCents(distributableCents),
    members: memberSettlements.map(({ should_get_cents, actual_cents, diff_cents, ...rest }) => rest),
    transfers: buildTransfers(memberSettlements)
  };
}

module.exports = { calculateSettlement };
