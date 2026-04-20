const { fetchSettlement, settle } = require("../services/settlement-service");

function settleController(req, res, next) {
  try {
    res.json(settle(Number(req.query.team_id), req.query.month));
  } catch (error) {
    next(error);
  }
}

function getSettlementController(req, res, next) {
  try {
    res.json(fetchSettlement(Number(req.query.team_id), req.query.month));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  settleController,
  getSettlementController
};
