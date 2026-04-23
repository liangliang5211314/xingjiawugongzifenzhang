const { addRecord, editRecord, removeRecord, getRecords } = require('../services/record-service');
const { getRecordById } = require('../models/record-model');
const autoSettleService = require('../services/auto-settle-service');
const { assertCanManageTeam } = require('../middleware/auth');
const { HttpError } = require('../utils/http-error');

function listRecordsController(req, res, next) {
  try {
    const { team_id, month } = req.query;
    const teamId = team_id ? Number(team_id) : undefined;
    if (req.user.role === 'admin') {
      return res.json({ ok: true, data: getRecords({ teamId, month }) });
    }

    if (teamId) {
      assertCanManageTeam(req.user, teamId);
      return res.json({ ok: true, data: getRecords({ teamId, month }) });
    }

    res.json({ ok: true, data: getRecords({ teamIds: req.user.managed_team_ids, month }) });
  } catch (e) { next(e); }
}

function createRecordController(req, res, next) {
  try {
    assertCanManageTeam(req.user, Number(req.body.team_id));
    const record = addRecord({ ...req.body, created_by: req.user.id });
    res.status(201).json({ ok: true, data: record });
    setImmediate(() => {
      autoSettleService.checkAndRun(record.team_id, record.month).catch(() => {});
    });
  } catch (e) { next(e); }
}

function updateRecordController(req, res, next) {
  try {
    const record = getRecordById(Number(req.params.id));
    if (!record) throw new HttpError(404, '记录不存在');
    assertCanManageTeam(req.user, record.team_id);
    res.json({ ok: true, data: editRecord(Number(req.params.id), req.body) });
  } catch (e) { next(e); }
}

function deleteRecordController(req, res, next) {
  try {
    const record = getRecordById(Number(req.params.id));
    if (!record) throw new HttpError(404, '记录不存在');
    assertCanManageTeam(req.user, record.team_id);
    removeRecord(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { next(e); }
}

module.exports = { listRecordsController, createRecordController, updateRecordController, deleteRecordController };
