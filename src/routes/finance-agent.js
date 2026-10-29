const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { timingSafeEqual } = require('crypto');
const { db } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { createFinanceAgent } = require('../services/finance-agent-service');
const { HttpError } = require('../utils/http-error');

function privateConfig() {
  const file = process.env.FINANCE_AGENT_CONFIG || path.join(__dirname, '../../data/finance-agent-private.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
function bridgeAuth(req, res, next) {
  try {
    const key = privateConfig().bridge_token || '';
    const supplied = String(req.headers['x-finance-token'] || '');
    if (key.length < 32 || Buffer.byteLength(key) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(supplied))) throw new HttpError(403, '财务桥认证失败');
    next();
  } catch (error) { next(error); }
}
const {recognize}=require('../services/finance-vision');
const service = createFinanceAgent({ db, recognize,
  previewSettlement: (teamId, month) => {
    const team = require('../models/team-model').getTeamById(teamId);
    const records = require('../models/record-model').getRecordsByTeamAndMonth(teamId, month);
    if (!records.length) throw new HttpError(400, '该月没有财务数据');
    const users = require('../models/user-model').listUsers({ teamId });
    const accounts = Object.fromEntries(users.map(u => [u.name, u.jd_account || u.name]));
    const result = require('../utils/settlement').calculateSettlement(team, [...new Set(records.map(r => r.person_name))], records, accounts);
    result.expense_items = records.filter(r => r.item_type === 'expense').map(r => ({ item_name:r.item_name,amount:Math.abs(r.amount)/100,payer_name:r.payer_name || r.person_name,note:r.note || '' }));
    return result;
  },
  publishSettlement: (teamId, month) => require('../services/settlement-service').runSettlement(teamId, month),
  onError: error => console.error('[finance-agent]', error.name) });
service.resume();
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 3 } });
const admin = [authenticate, authorize('admin')];
const sync = handler => (req, res, next) => { try { res.json({ ok: true, data: handler(req) }); } catch (error) { next(error); } };
const chatRuntime = require('../services/agent-chat-runtime');

router.get('/chat-bindings', ...admin, sync(req => ({account_id:chatRuntime.settings().accountId,
  bindings:chatRuntime.service.bindings(req.user.id),users:db.prepare('SELECT id,name,role FROM users WHERE status=1 ORDER BY id').all()})));
router.post('/chat-bindings', ...admin, sync(req => chatRuntime.service.bind(req.body,req.user.id)));
router.get('/group-push',...admin,sync(()=>chatRuntime.service.groupPushStatus()));
router.post('/group-push',...admin,sync(req=>chatRuntime.service.configureGroupPush(req.body,req.user.id)));
router.get('/collection-status',...admin,sync(()=>chatRuntime.service.collectionStatus()));

router.post('/bridge/exchange', bridgeAuth, sync(req => service.exchange(req.body)));
router.get('/status', ...admin, sync(() => ({ scope: service.getScope() || null, bindings: service.bindings(), submissions: service.list(), reviews:service.reviews(),
  model_configured: !!privateConfig().bridge_token, owner_alias: 'ZML741213442' })));
router.post('/scope', ...admin, sync(req => service.configure(req.body)));
router.post('/bindings', ...admin, sync(req => service.bind(req.body, req.user.id)));
router.post('/upload', ...admin, upload.single('image'), sync(req => {
  if (!req.file) throw new HttpError(400, '请上传图片');
  return service.submit({ account_id: `web:${req.user.id}`, sender_id: `web-member:${Number(req.body.user_id)}`,
    message_id: require('crypto').randomUUID(), user_id: req.body.user_id, actor_id: req.user.id, image: req.file.buffer });
}));
router.get('/submissions/:id/image', ...admin, (req, res, next) => {
  try {
    const row = service.image(req.params.id);
    if (!row?.image_data) throw new HttpError(404, '原图不存在');
    res.set({ 'Content-Type': row.mime_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(row.image_data);
  } catch (error) { next(error); }
});
router.post('/submissions/:id/retry', ...admin, (req, res, next) => {
  service.process(req.params.id).then(data => res.json({ ok: true, data })).catch(next);
});
router.post('/submissions/:id/confirm', ...admin, sync(req => service.confirm(req.params.id, req.body, { admin: req.user.id })));
router.post('/submissions/:id/cancel', ...admin, sync(req => service.cancel(req.params.id, req.user.id)));
router.post('/reviews', ...admin, sync(req => service.requestReview(req.body.month, {admin:req.user.id,confirmed_complete:req.body.confirmed_complete})));

module.exports = { router, service };
