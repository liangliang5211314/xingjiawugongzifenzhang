const express = require('express');
const morgan = require('morgan');
const path = require('path');
const { apiRouter, authRouter, memberRouter } = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { authenticate } = require('./middleware/auth');

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

// 后台管理页面（服务端渲染）
app.get('/', (req, res) => res.render('login'));
app.get('/admin/dashboard',   (req, res) => res.render('dashboard'));
app.get('/admin/teams',       (req, res) => res.render('teams'));
app.get('/admin/users',       (req, res) => res.render('users'));
app.get('/admin/records',     (req, res) => res.render('records'));
app.get('/admin/settlement',  (req, res) => res.render('settlement'));
app.get('/admin/push-logs',       (req, res) => res.render('push-logs'));
app.get('/admin/member-reports',  (req, res) => res.render('member-reports'));

// 成员H5页面
app.get('/h5/home',    (req, res) => res.render('member/home'));
app.get('/h5/history', (req, res) => res.render('member/history'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
