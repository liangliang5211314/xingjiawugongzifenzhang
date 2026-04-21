const express = require('express');
const morgan = require('morgan');
const path = require('path');
const { version } = require('../package.json');
const { apiRouter, authRouter, memberRouter } = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { authenticate } = require('./middleware/auth');

const CHANGELOG = [
  { ver: '1.4.0', date: '2026-04-22', notes: '多团队支持；成员上报类型（京粉/淘宝/支出）；团队配置表单化；结算页显示成员收入预览；修复微信登录覆盖姓名问题' },
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
app.get('/api/version', (req, res) => res.json({ version, changelog: CHANGELOG }));

// 后台管理页面（服务端渲染）
const adminRender = (view) => (req, res) => res.render(view, { appVersion: version });
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
