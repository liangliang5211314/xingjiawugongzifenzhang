const { getUsers, createMember, updateMember } = require('../services/user-service');

function listUsersController(req, res, next) {
  try {
    const { team_id, role } = req.query;
    res.json({ ok: true, data: getUsers({ teamId: team_id ? Number(team_id) : undefined, role }) });
  } catch (e) { next(e); }
}

function createUserController(req, res, next) {
  try { res.status(201).json({ ok: true, data: createMember(req.body) }); }
  catch (e) { next(e); }
}

function updateUserController(req, res, next) {
  try { res.json({ ok: true, data: updateMember(Number(req.params.id), req.body) }); }
  catch (e) { next(e); }
}

module.exports = { listUsersController, createUserController, updateUserController };
