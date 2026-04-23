const { listTeams, createNewTeam, updateExistingTeam } = require('../services/team-service');
const { deleteTeamById, getTeamById } = require('../models/team-model');
const { HttpError } = require('../utils/http-error');
const { canManageTeam } = require('../middleware/auth');

function listTeamsController(req, res, next) {
  try {
    const teams = listTeams();
    const data = req.user.role === 'admin'
      ? teams
      : teams.filter(t => req.user.managed_team_ids.includes(t.id));
    res.json({ ok: true, data });
  } catch (e) { next(e); }
}

function createTeamController(req, res, next) {
  try {
    if (req.user.role !== 'admin') throw new HttpError(403, '只有管理员可以新建团队');
    res.status(201).json({ ok: true, data: createNewTeam(req.body) });
  } catch (e) { next(e); }
}

function updateTeamController(req, res, next) {
  try {
    const teamId = Number(req.params.id);
    if (!canManageTeam(req.user, teamId)) throw new HttpError(403, '只能修改自己负责的团队');
    const payload = { ...req.body };
    if (req.user.role !== 'admin') delete payload.leader_user_id;
    res.json({ ok: true, data: updateExistingTeam(teamId, payload) });
  } catch (e) { next(e); }
}

function deleteTeamController(req, res, next) {
  try {
    if (req.user.role !== 'admin') throw new HttpError(403, '只有管理员可以删除团队');
    deleteTeamById(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { listTeamsController, createTeamController, updateTeamController, deleteTeamController };
