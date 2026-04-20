const { listStats } = require("../services/record-service");

function yearStatsController(req, res, next) {
  try {
    res.json(listStats("year"));
  } catch (error) {
    next(error);
  }
}

function monthStatsController(req, res, next) {
  try {
    res.json(listStats("month"));
  } catch (error) {
    next(error);
  }
}

module.exports = {
  yearStatsController,
  monthStatsController
};
