const { addRecord, editRecord, removeRecord, getRecords } = require('../services/record-service');
const { getAllTeams } = require('../models/team-model');
const { listUsers } = require('../models/user-model');
const autoSettleService = require('../services/auto-settle-service');

function listRecordsController(req, res, next) {
  try {
    const { team_id, month } = req.query;
    res.json({ ok: true, data: getRecords({ teamId: team_id ? Number(team_id) : undefined, month }) });
  } catch (e) { next(e); }
}

function createRecordController(req, res, next) {
  try {
    const record = addRecord({ ...req.body, created_by: req.user.id });
    res.status(201).json({ ok: true, data: record });
    // 异步挂钩：不阻塞响应，异常不影响主流程
    setImmediate(() => {
      autoSettleService.checkAndRun(record.team_id, record.month).catch(() => {});
    });
  } catch (e) { next(e); }
}

function updateRecordController(req, res, next) {
  try { res.json({ ok: true, data: editRecord(Number(req.params.id), req.body) }); }
  catch (e) { next(e); }
}

function deleteRecordController(req, res, next) {
  try { removeRecord(Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { next(e); }
}

module.exports = { listRecordsController, createRecordController, updateRecordController, deleteRecordController };
