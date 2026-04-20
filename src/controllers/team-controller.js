const { createTeamWithOptionalUser, listTeams, updateExistingTeam } = require("../services/team-service");

function listTeamsController(req, res, next) {
  try {
    res.json(listTeams());
  } catch (error) {
    next(error);
  }
}

function createTeamController(req, res, next) {
  try {
    res.status(201).json(createTeamWithOptionalUser(req.body));
  } catch (error) {
    next(error);
  }
}

function updateTeamController(req, res, next) {
  try {
    res.json(updateExistingTeam(Number(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listTeamsController,
  createTeamController,
  updateTeamController
};
