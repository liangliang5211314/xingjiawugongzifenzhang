const { addExistingMemberToTeam, addMember, listMembers } = require("../services/member-service");

function listMembersController(req, res, next) {
  try {
    res.json(listMembers(Number(req.query.team_id)));
  } catch (error) {
    next(error);
  }
}

function createMemberController(req, res, next) {
  try {
    res.status(201).json(addMember(req.body));
  } catch (error) {
    next(error);
  }
}

function linkMemberToTeamController(req, res, next) {
  try {
    res.json(
      addExistingMemberToTeam(
        Number(req.body.member_id),
        Number(req.body.team_id),
        !!req.body.is_leader
      )
    );
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listMembersController,
  createMemberController,
  linkMemberToTeamController
};
