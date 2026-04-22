const path = require('path');
const multer = require('multer');
const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');

const { loginController, meController, wechatStartController, wechatCallbackController } = require('../controllers/auth-controller');
const { listTeamsController, createTeamController, updateTeamController, deleteTeamController } = require('../controllers/team-controller');
const { listUsersController, createUserController, updateUserController, deleteUserController } = require('../controllers/user-controller');
const { listRecordsController, createRecordController, updateRecordController, deleteRecordController } = require('../controllers/record-controller');
const { runSettlementController, listSettlementsController, pushSettlementController, deleteSettlementController } = require('../controllers/settlement-controller');
const { syncRecordsController, syncSettlementController } = require('../controllers/feishu-controller');
const { dashboardController } = require('../controllers/stats-controller');
const { memberMeController, memberCurrentIncomeController, memberIncomeHistoryController, memberUpdateProfileController } = require('../controllers/member-h5-controller');
const { submitReportController, getMyReportController, listReportsController } = require('../controllers/member-report-controller');
const { listPushLogs } = require('../models/push-log-model');

// 图片上传配置（保存到 public/uploads/）
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'public', 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

// ─── 管理端 API ────────────────────────────────────────────────
const apiRouter = express.Router();

apiRouter.post('/login', loginController);
apiRouter.get('/me', authenticate, meController);
apiRouter.get('/dashboard', authenticate, authorize('admin'), dashboardController);

// 团队
apiRouter.get('/teams',        authenticate, authorize('admin'), listTeamsController);
apiRouter.post('/teams',       authenticate, authorize('admin'), createTeamController);
apiRouter.put('/teams/:id',    authenticate, authorize('admin'), updateTeamController);
apiRouter.delete('/teams/:id', authenticate, authorize('admin'), deleteTeamController);

// 用户/成员
apiRouter.get('/users',        authenticate, authorize('admin'), listUsersController);
apiRouter.post('/users',       authenticate, authorize('admin'), createUserController);
apiRouter.put('/users/:id',    authenticate, authorize('admin'), updateUserController);
apiRouter.delete('/users/:id', authenticate, authorize('admin'), deleteUserController);

// 收入台账
apiRouter.get('/records',        authenticate, authorize('admin'), listRecordsController);
apiRouter.post('/records',       authenticate, authorize('admin'), createRecordController);
apiRouter.put('/records/:id',    authenticate, authorize('admin'), updateRecordController);
apiRouter.delete('/records/:id', authenticate, authorize('admin'), deleteRecordController);

// 结算
apiRouter.post('/settlements/run',         authenticate, authorize('admin'), runSettlementController);
apiRouter.get('/settlements',              authenticate, authorize('admin'), listSettlementsController);
apiRouter.post('/settlements/:id/push',    authenticate, authorize('admin'), pushSettlementController);
apiRouter.delete('/settlements/:id',       authenticate, authorize('admin'), deleteSettlementController);

// 飞书同步
apiRouter.post('/feishu/sync-records',    authenticate, authorize('admin'), syncRecordsController);
apiRouter.post('/feishu/sync-settlement', authenticate, authorize('admin'), syncSettlementController);

// 成员上报（管理员查看）
apiRouter.get('/member-reports', authenticate, authorize('admin'), listReportsController);

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
memberRouter.get('/me',             authenticate, memberMeController);
memberRouter.put('/profile',        authenticate, memberUpdateProfileController);
memberRouter.get('/income/current', authenticate, memberCurrentIncomeController);
memberRouter.get('/income/history', authenticate, memberIncomeHistoryController);
memberRouter.post('/report',        authenticate, upload.single('screenshot'), submitReportController);
memberRouter.get('/report',         authenticate, getMyReportController);

module.exports = { apiRouter, authRouter, memberRouter };
