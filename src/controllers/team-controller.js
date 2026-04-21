const { listTeams, createNewTeam, updateExistingTeam } = require('../services/team-service');

function listTeamsController(req, res, next) {
  try { res.json({ ok: true, data: listTeams() }); }
  catch (e) { next(e); }
}

function createTeamController(req, res, next) {
  try { res.status(201).json({ ok: true, data: createNewTeam(req.body) }); }
  catch (e) { next(e); }
}

function updateTeamController(req, res, next) {
  try { res.json({ ok: true, data: updateExistingTeam(Number(req.params.id), req.body) }); }
  catch (e) { next(e); }
}

module.exports = { listTeamsController, createTeamController, updateTeamController };
