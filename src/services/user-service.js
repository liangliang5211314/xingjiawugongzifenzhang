const bcrypt = require('bcryptjs');
const { listUsers, createUser, updateUser, findById, setUserTeams, getUserTeamIds } = require('../models/user-model');
const { getTeamById } = require('../models/team-model');
const { HttpError } = require('../utils/http-error');

function normalizeTeamIds(team_ids, team_id) {
  return Array.isArray(team_ids)
    ? team_ids.map(Number).filter(Boolean)
    : team_id ? [Number(team_id)] : [];
}

function assertManageableTeamIds(actor, ids) {
  for (const id of ids) {
    if (!getTeamById(id)) throw new HttpError(404, '团队不存在');
    if (actor.role !== 'admin' && !actor.managed_team_ids.includes(id)) {
      throw new HttpError(403, '只能管理自己负责团队的成员');
    }
  }
}

function assertManageableTarget(actor, targetUser) {
  if (actor.role === 'admin') return;
  const teamIds = getUserTeamIds(targetUser.id);
  if (!teamIds.some(id => actor.managed_team_ids.includes(id))) {
    throw new HttpError(403, '只能管理自己负责团队的成员');
  }
}

function getUsers({ actor, teamId, role } = {}) {
  if (actor.role === 'admin') {
    return listUsers({ teamId, role });
  }

  if (teamId) {
    if (!actor.managed_team_ids.includes(teamId)) throw new HttpError(403, '只能查看自己负责的团队');
    return listUsers({ teamId, role });
  }

  return listUsers({ teamIds: actor.managed_team_ids, role });
}

function createMember(actor, { name, mobile, role, team_ids, team_id, username, password, ...rest }) {
  if (!name) throw new HttpError(400, '姓名不能为空');
  const ids = normalizeTeamIds(team_ids, team_id);
  assertManageableTeamIds(actor, ids);

  const userRole = role === 'admin'
    ? (actor.role === 'admin' ? 'admin' : (() => { throw new HttpError(403, '队长不能创建管理员'); })())
    : 'member';

  const password_hash = password ? bcrypt.hashSync(password, 10) : null;
  const user = createUser({
    name,
    mobile,
    username: username || null,
    password_hash,
    role: userRole,
    openid: rest.openid || null,
    team_id: ids[0] || null,
  });
  if (Object.keys(rest).length > 0) updateUser(user.id, rest);
  if (ids.length > 0) setUserTeams(user.id, ids);
  return findById(user.id);
}

function updateMember(actor, id, fields) {
  const existing = findById(id);
  if (!existing) throw new HttpError(404, '用户不存在');
  assertManageableTarget(actor, existing);

  const { team_ids, team_id, password, role, ...rest } = fields;
  const updates = { ...rest };
  if (password) updates.password_hash = bcrypt.hashSync(password, 10);

  if (role !== undefined) {
    if (actor.role !== 'admin' && role === 'admin') throw new HttpError(403, '队长不能授予管理员');
    updates.role = role === 'admin' ? 'admin' : 'member';
  }

  if (Object.keys(updates).length > 0) updateUser(id, updates);

  if (team_ids !== undefined || team_id !== undefined) {
    const ids = normalizeTeamIds(team_ids, team_id);
    assertManageableTeamIds(actor, ids);
    setUserTeams(id, ids);
  }

  return findById(id);
}

function assertCanDeleteMember(actor, id) {
  const existing = findById(id);
  if (!existing) throw new HttpError(404, '用户不存在');
  assertManageableTarget(actor, existing);
  if (existing.role === 'admin' && actor.role !== 'admin') {
    throw new HttpError(403, '队长不能删除管理员');
  }
}

module.exports = { getUsers, createMember, updateMember, assertCanDeleteMember };
