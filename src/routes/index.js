const express = require('express');
const { authenticate, authorize, ensureTeamAccess } = require('../middleware/auth');

const { loginController, meController, wechatStartController, wechatCallbackController } = require('../controllers/auth-controller');
const { listTeamsController, createTeamController, updateTeamController } = require('../controllers/team-controller');
const { listUsersController, createUserController, updateUserController } = require('../controllers/user-controller');
const { listRecordsController, createRecordController, updateRecordController, deleteRecordController } = require('../controllers/record-controller');
const { runSettlementController, listSettlementsController, pushSettlementController } = require('../controllers/settlement-controller');
const { syncRecordsController, syncSettlementController } = require('../controllers/feishu-controller');
const { dashboardController } = require('../controllers/stats-controller');
const { memberMeController, memberCurrentIncomeController, memberIncomeHistoryController } = require('../controllers/member-h5-controller');
const { listPushLogs } = require('../models/push-log-model');

// ─── 管理端 API ────────────────────────────────────────────────
const apiRouter = express.Router();

apiRouter.post('/login', loginController);
apiRouter.get('/me', authenticate, meController);
apiRouter.get('/dashboard', authenticate, authorize('admin'), dashboardController);

// 团队
apiRouter.get('/teams',     authenticate, authorize('admin'), listTeamsController);
apiRouter.post('/teams',    authenticate, authorize('admin'), createTeamController);
apiRouter.put('/teams/:id', authenticate, authorize('admin'), updateTeamController);

// 用户/成员
apiRouter.get('/users',      authenticate, authorize('admin'), listUsersController);
apiRouter.post('/users',     authenticate, authorize('admin'), createUserController);
apiRouter.put('/users/:id',  authenticate, authorize('admin'), updateUserController);

// 收入台账
apiRouter.get('/records',        authenticate, authorize('admin'), listRecordsController);
apiRouter.post('/records',       authenticate, authorize('admin'), createRecordController);
apiRouter.put('/records/:id',    authenticate, authorize('admin'), updateRecordController);
apiRouter.delete('/records/:id', authenticate, authorize('admin'), deleteRecordController);

// 结算
apiRouter.post('/settlements/run',     authenticate, authorize('admin'), runSettlementController);
apiRouter.get('/settlements',          authenticate, authorize('admin'), listSettlementsController);
apiRouter.post('/settlements/:id/push', authenticate, authorize('admin'), pushSettlementController);

// 飞书同步
apiRouter.post('/feishu/sync-records',    authenticate, authorize('admin'), syncRecordsController);
apiRouter.post('/feishu/sync-settlement', authenticate, authorize('admin'), syncSettlementController);

// 推送日志
apiRouter.get('/push-logs', authenticate, authorize('admin'), (req, res, next) => {
  try {
    const logs = listPushLogs({ settlementId: req.query.settlement_id ? Number(req.query.settlement_id) : undefined });
    res.json({ ok: true, data: logs });
  } catch (e) { next(e); }
});

// ─── 微信授权路由 ────────────────────────────────────────────────
const authRouter = express.Router();
authRouter.get('/wechat/start',    wechatStartController);
authRouter.get('/wechat/callback', wechatCallbackController);

// ─── 成员H5 API ────────────────────────────────────────────────
const memberRouter = express.Router();
memberRouter.get('/me',              authenticate, memberMeController);
memberRouter.get('/income/current',  authenticate, memberCurrentIncomeController);
memberRouter.get('/income/history',  authenticate, memberIncomeHistoryController);

module.exports = { apiRouter, authRouter, memberRouter };
