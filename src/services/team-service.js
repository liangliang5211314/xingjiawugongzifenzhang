const { createTeam, getAllTeams, getTeamById, getTeamByName, updateTeam } = require('../models/team-model');
const { HttpError } = require('../utils/http-error');

function normalizeRuleConfig(rule_type, rule_config = {}) {
  if (rule_type === 'zteam') {
    return {
      leader_name: rule_config.leader_name || '张明亮',
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
  throw new HttpError(400, '不支持的rule_type');
}

function listTeams() {
  return getAllTeams();
}

function createNewTeam({ name, rule_type, rule_config }) {
  if (!name) throw new HttpError(400, '团队名称不能为空');
  if (!rule_type) throw new HttpError(400, '请选择分账规则类型');
  if (getTeamByName(name)) throw new HttpError(409, '团队名称已存在');
  const config = normalizeRuleConfig(rule_type, rule_config || {});
  return createTeam({ name, rule_type, rule_config: config });
}

function updateExistingTeam(teamId, { name, rule_type, rule_config, status }) {
  const existing = getTeamById(teamId);
  if (!existing) throw new HttpError(404, '团队不存在');
  if (name && name !== existing.name && getTeamByName(name)) throw new HttpError(409, '团队名称已存在');
  const config = rule_type ? normalizeRuleConfig(rule_type, rule_config || {}) : existing.rule_config;
  return updateTeam(teamId, { name, rule_type, rule_config: config, status });
}

module.exports = { listTeams, createNewTeam, updateExistingTeam };
