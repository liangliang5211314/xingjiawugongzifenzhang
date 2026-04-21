const bcrypt = require('bcryptjs');
const { listUsers, createUser, updateUser, findById, getUserTeamIds, setUserTeams } = require('../models/user-model');
const { getTeamById } = require('../models/team-model');
const { HttpError } = require('../utils/http-error');

function getUsers({ teamId, role } = {}) {
  return listUsers({ teamId, role });
}

function createMember({ name, mobile, role, team_ids, team_id, username, password }) {
  if (!name) throw new HttpError(400, '姓名不能为空');
  const ids = Array.isArray(team_ids) ? team_ids.map(Number).filter(Boolean)
            : team_id ? [Number(team_id)]
            : [];
  for (const id of ids) {
    if (!getTeamById(id)) throw new HttpError(404, '团队不存在');
  }
  const userRole = role === 'admin' ? 'admin' : 'member';
  const password_hash = password ? bcrypt.hashSync(password, 10) : null;
  const user = createUser({ name, mobile, username: username || null, password_hash, role: userRole });
  if (ids.length > 0) setUserTeams(user.id, ids);
  return findById(user.id);
}

function updateMember(id, fields) {
  if (!findById(id)) throw new HttpError(404, '用户不存在');
  const { team_ids, team_id, password, ...rest } = fields;
  if (password) rest.password_hash = bcrypt.hashSync(password, 10);
  if (Object.keys(rest).length > 0) updateUser(id, rest);
  if (team_ids !== undefined) {
    const ids = Array.isArray(team_ids) ? team_ids.map(Number).filter(Boolean) : [];
    setUserTeams(id, ids);
  } else if (team_id !== undefined) {
    setUserTeams(id, team_id ? [Number(team_id)] : []);
  }
  return findById(id);
}

module.exports = { getUsers, createMember, updateMember };
