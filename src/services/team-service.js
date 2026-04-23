const { createTeam, getAllTeams, getTeamById, getTeamByName, updateTeam } = require('../models/team-model');
const { getUserTeamIds, findById } = require('../models/user-model');
const { HttpError } = require('../utils/http-error');
const { getRuleMembers, setRuleMembers } = require('../models/team-rule-member-model');

function normalizeRuleConfig(rule_type, rule_config = {}) {
  if (rule_type === 'zteam') {
    return {
      leader_name: rule_config.leader_name || '',
      leader_ratio: Number(rule_config.leader_ratio ?? 0.2),
      reimburse_expenses: rule_config.reimburse_expenses !== false,
    };
  }
  if (rule_type === 'standard') {
    return {
      leader_name: rule_config.leader_name || null,
      leader_ratio: Number(rule_config.leader_ratio ?? 0.2),
    };
  }
  if (rule_type === 'custom') {
    return {
      allocations: Array.isArray(rule_config.allocations) ? rule_config.allocations : [],
    };
  }
  throw new HttpError(400, '不支持的 rule_type');
}

function normalizeNameList(values) {
  return Array.isArray(values)
    ? values.map(v => String(v || '').trim()).filter(Boolean)
    : [];
}

function validateLeader(leaderUserId, teamMemberNames, teamId) {
  if (!leaderUserId) return null;
  const leader = findById(Number(leaderUserId));
  if (!leader) throw new HttpError(404, '队长用户不存在');
  if (teamId) {
    const leaderTeamIds = getUserTeamIds(leader.id);
    if (!leaderTeamIds.includes(teamId)) {
      throw new HttpError(400, '队长必须属于该团队');
    }
  } else if (teamMemberNames.length > 0 && !teamMemberNames.includes(leader.name)) {
    throw new HttpError(400, '队长必须是该团队成员');
  }
  return leader.id;
}

function listTeams() {
  return getAllTeams().map(t => ({ ...t, rule_members: getRuleMembers(t.id) }));
}

function createNewTeam({ name, rule_type, rule_config, rule_members, report_member_names, leader_user_id }) {
  if (!name) throw new HttpError(400, '团队名称不能为空');
  if (!rule_type) throw new HttpError(400, '请选择分账规则类型');
  if (getTeamByName(name)) throw new HttpError(409, '团队名称已存在');

  const config = normalizeRuleConfig(rule_type, rule_config || {});
  const normalizedRuleMembers = Array.isArray(rule_members) ? rule_members : [];
  const teamMemberNames = normalizedRuleMembers.map(m => m.member_name).filter(Boolean);
  const team = createTeam({
    name,
    rule_type,
    rule_config: config,
    report_member_names: normalizeNameList(report_member_names),
    leader_user_id: validateLeader(leader_user_id, teamMemberNames),
  });
  if (normalizedRuleMembers.length > 0) setRuleMembers(team.id, normalizedRuleMembers);
  return { ...team, rule_members: getRuleMembers(team.id) };
}

function updateExistingTeam(teamId, {
  name,
  rule_type,
  rule_config,
  status,
  rule_members,
  wecom_webhook_url,
  auto_settle_enabled,
  auto_push_enabled,
  report_member_names,
  leader_user_id,
}) {
  const existing = getTeamById(teamId);
  if (!existing) throw new HttpError(404, '团队不存在');
  if (name && name !== existing.name && getTeamByName(name)) throw new HttpError(409, '团队名称已存在');

  const config = rule_type ? normalizeRuleConfig(rule_type, rule_config || {}) : existing.rule_config;
  const nextRuleMembers = Array.isArray(rule_members) ? rule_members : getRuleMembers(teamId);
  const teamMemberNames = nextRuleMembers.map(m => m.member_name).filter(Boolean);

  const team = updateTeam(teamId, {
    name,
    rule_type,
    rule_config: config,
    status,
    wecom_webhook_url,
    auto_settle_enabled,
    auto_push_enabled,
    report_member_names: Array.isArray(report_member_names) ? normalizeNameList(report_member_names) : undefined,
    leader_user_id: leader_user_id !== undefined ? validateLeader(leader_user_id, teamMemberNames, teamId) : undefined,
  });
  if (Array.isArray(rule_members)) setRuleMembers(teamId, rule_members);
  return { ...team, rule_members: getRuleMembers(teamId) };
}

module.exports = { listTeams, createNewTeam, updateExistingTeam };
