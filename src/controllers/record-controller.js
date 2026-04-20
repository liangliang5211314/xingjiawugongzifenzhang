const { addRecord } = require("../services/record-service");

function createRecordController(req, res, next) {
  try {
    res.status(201).json(addRecord(req.body));
  } catch (error) {
    next(error);
  }
}

module.exports = { createRecordController };
