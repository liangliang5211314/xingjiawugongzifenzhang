const path = require('path');
const multer = require('multer');
const express = require('express');
const { authenticate, authorize, authorizeAdminOrLeader } = require('../middleware/auth');

const { loginController, meController, wechatStartController, wechatCallbackController } = require('../controllers/auth-controller');
const { listTeamsController, createTeamController, updateTeamController, deleteTeamController } = require('../controllers/team-controller');
const { listUsersController, createUserController, updateUserController, deleteUserController } = require('../controllers/user-controller');
const { listRecordsController, createRecordController, updateRecordController, deleteRecordController } = require('../controllers/record-controller');
const { runSettlementController, listSettlementsController, pushSettlementController, deleteSettlementController, wecomPushController } = require('../controllers/settlement-controller');
const { syncRecordsController, syncSettlementController } = require('../controllers/feishu-controller');
const { dashboardController } = require('../controllers/stats-controller');
const { memberMeController, memberCurrentIncomeController, memberIncomeHistoryController, memberUpdateProfileController } = require('../controllers/member-h5-controller');
const { submitReportController, getMyReportController, listReportsController } = require('../controllers/member-report-controller');
const { listPushLogs } = require('../models/push-log-model');
const { getSettlementById } = require('../models/settlement-model');

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'public', 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

const apiRouter = express.Router();

apiRouter.post('/login', loginController);
apiRouter.get('/me', authenticate, meController);
apiRouter.get('/dashboard', authenticate, authorize('admin'), dashboardController);

apiRouter.get('/teams',        authenticate, authorizeAdminOrLeader, listTeamsController);
apiRouter.post('/teams',       authenticate, authorizeAdminOrLeader, createTeamController);
apiRouter.put('/teams/:id',    authenticate, authorizeAdminOrLeader, updateTeamController);
apiRouter.delete('/teams/:id', authenticate, authorizeAdminOrLeader, deleteTeamController);

apiRouter.get('/users',        authenticate, authorizeAdminOrLeader, listUsersController);
apiRouter.post('/users',       authenticate, authorizeAdminOrLeader, createUserController);
apiRouter.put('/users/:id',    authenticate, authorizeAdminOrLeader, updateUserController);
apiRouter.delete('/users/:id', authenticate, authorizeAdminOrLeader, deleteUserController);

apiRouter.get('/records',        authenticate, authorizeAdminOrLeader, listRecordsController);
apiRouter.post('/records',       authenticate, authorizeAdminOrLeader, createRecordController);
apiRouter.put('/records/:id',    authenticate, authorizeAdminOrLeader, updateRecordController);
apiRouter.delete('/records/:id', authenticate, authorizeAdminOrLeader, deleteRecordController);

apiRouter.post('/settlements/run',            authenticate, authorizeAdminOrLeader, runSettlementController);
apiRouter.get('/settlements',                 authenticate, authorizeAdminOrLeader, listSettlementsController);
apiRouter.post('/settlements/:id/push',       authenticate, authorizeAdminOrLeader, pushSettlementController);
apiRouter.post('/settlements/:id/wecom-push', authenticate, authorizeAdminOrLeader, wecomPushController);
apiRouter.delete('/settlements/:id',          authenticate, authorizeAdminOrLeader, deleteSettlementController);

apiRouter.post('/feishu/sync-records',    authenticate, authorizeAdminOrLeader, syncRecordsController);
apiRouter.post('/feishu/sync-settlement', authenticate, authorizeAdminOrLeader, syncSettlementController);

apiRouter.get('/member-reports', authenticate, authorizeAdminOrLeader, listReportsController);

apiRouter.get('/push-logs', authenticate, authorizeAdminOrLeader, (req, res, next) => {
  try {
    const settlementId = req.query.settlement_id ? Number(req.query.settlement_id) : undefined;
    let teamIds;
    if (req.user.role !== 'admin') {
      if (settlementId) {
        const settlement = getSettlementById(settlementId);
        if (!settlement || !req.user.managed_team_ids.includes(settlement.team_id)) {
          return res.status(403).json({ ok: false, message: '只能查看自己负责团队的推送日志' });
        }
      }
      teamIds = req.user.managed_team_ids;
    }
    const logs = listPushLogs({ settlementId, teamIds });
    res.json({ ok: true, data: logs });
  } catch (e) { next(e); }
});

const authRouter = express.Router();
authRouter.get('/wechat/start', wechatStartController);
authRouter.get('/wechat/callback', wechatCallbackController);

const memberRouter = express.Router();
memberRouter.get('/me',             authenticate, memberMeController);
memberRouter.put('/profile',        authenticate, memberUpdateProfileController);
memberRouter.get('/income/current', authenticate, memberCurrentIncomeController);
memberRouter.get('/income/history', authenticate, memberIncomeHistoryController);
memberRouter.post('/report',        authenticate, upload.single('screenshot'), submitReportController);
memberRouter.get('/report',         authenticate, getMyReportController);

module.exports = { apiRouter, authRouter, memberRouter };
