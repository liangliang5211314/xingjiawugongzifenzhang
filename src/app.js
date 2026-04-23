const express = require('express');
const morgan = require('morgan');
const path = require('path');
const { execSync } = require('child_process');
const { version } = require('../package.json');
const { apiRouter, authRouter, memberRouter } = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { authenticate } = require('./middleware/auth');

let gitHash = '';
try { gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch (e) {}
const displayVersion = gitHash ? version + '-' + gitHash : version;

const CHANGELOG = [
  { ver: '1.7.0', date: '2026-04-24', notes: '成员管理显示微信 OpenID；支持手动绑定/合并微信授权用户与本地用户' },
  { ver: '1.6.0', date: '2026-04-24', notes: '新增京粉账户（jd_account）字段；转账方案按京粉账户聚合（多成员共用同一账户自动合并）；数据录入列表按录入时间倒序；团队删除改为自定义弹窗（修复宝塔面板 iframe 下 confirm 失效）；团队删除级联清除关联数据' },
  { ver: '1.5.0', date: '2026-04-23', notes: 'H5历史对比修复（切换月份不再显示旧数据）；H5新增团队总收入同比与个人收入同比（含%）；成员改名崔如意（原崔小易，数据库同步修正）；数据录入默认显示当前月份，新增"全部时间"按钮' },
  { ver: '1.4.0', date: '2026-04-22', notes: '企业微信 Webhook 推送（自动+手动）；全员提交后自动结算；结算同比增加前前年对比及百分比；结算成员明细加个人历史同月收入对比；微信授权跳转页显示系统名称' },
  { ver: '1.3.0', date: '2026-04-21', notes: '成员自报收益（含截图上传）；数据录入页嵌入上报数据；结算页显示分成规则说明' },
  { ver: '1.2.0', date: '2026-04-20', notes: '成员H5：编辑资料（京粉信息）；微信OAuth登录；一键部署脚本' },
  { ver: '1.1.0', date: '2026-04-19', notes: '多团队结算；飞书同步；微信模板消息推送；仪表盘年同比' },
  { ver: '1.0.0', date: '2026-04-18', notes: '初始版本：团队/成员/台账/结算基础功能' },
];

const app = express();

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// API路由
app.use('/api', apiRouter);
app.use('/auth', authRouter);
app.use('/member', memberRouter);

// 版本信息 API
app.get('/api/version', (req, res) => res.json({ version: displayVersion, changelog: CHANGELOG }));

// 后台管理页面（服务端渲染）
const adminRender = (view) => (req, res) => res.render(view, { appVersion: displayVersion });
app.get('/', (req, res) => res.render('login'));
app.get('/admin/dashboard',      adminRender('dashboard'));
app.get('/admin/teams',          adminRender('teams'));
app.get('/admin/users',          adminRender('users'));
app.get('/admin/records',        adminRender('records'));
app.get('/admin/settlement',     adminRender('settlement'));
app.get('/admin/push-logs',      adminRender('push-logs'));
app.get('/admin/member-reports', adminRender('member-reports'));

// 成员H5页面
app.get('/h5/home',    (req, res) => res.render('member/home'));
app.get('/h5/history', (req, res) => res.render('member/history'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
