const bcrypt = require('bcryptjs');
const { listUsers, createUser, updateUser, findById } = require('../models/user-model');
const { getTeamById } = require('../models/team-model');
const { HttpError } = require('../utils/http-error');

function getUsers({ teamId, role } = {}) {
  return listUsers({ teamId, role });
}

function createMember({ name, mobile, role, team_id, username, password }) {
  if (!name) throw new HttpError(400, '姓名不能为空');
  if (team_id && !getTeamById(team_id)) throw new HttpError(404, '团队不存在');

  const userRole = role === 'admin' ? 'admin' : 'member';
  const password_hash = password ? bcrypt.hashSync(password, 10) : null;

  return createUser({ name, mobile, username: username || null, password_hash, role: userRole, team_id: team_id || null });
}

function updateMember(id, fields) {
  if (!findById(id)) throw new HttpError(404, '用户不存在');
  if (fields.team_id && !getTeamById(fields.team_id)) throw new HttpError(404, '团队不存在');
  if (fields.password) {
    fields.password_hash = bcrypt.hashSync(fields.password, 10);
    delete fields.password;
  }
  return updateUser(id, fields);
}

module.exports = { getUsers, createMember, updateMember };
