const path = require('path');

const DEFAULT_JWT_SECRET = 'change-me-in-production';
const DEFAULT_ADMIN_PASSWORD = 'admin123456';

const env = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'app.db'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,

  // 微信公众号
  wxAppId: process.env.WX_APPID || '',
  wxSecret: process.env.WX_SECRET || '',
  wxRedirectUri: process.env.WX_REDIRECT_URI || '',
  wxTemplateId: process.env.WX_TEMPLATE_ID || '',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  // 飞书
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  feishuSpreadsheetToken: process.env.FEISHU_SPREADSHEET_TOKEN || '',
  feishuRecordsSheetId: process.env.FEISHU_RECORDS_SHEET_ID || '',
  feishuSettlementsSheetId: process.env.FEISHU_SETTLEMENTS_SHEET_ID || '',
};

// 启动时校验弱默认值：JWT_SECRET 缺省或 ADMIN_PASSWORD 为弱默认密码时拒绝启动。
// 本地开发可设 ALLOW_WEAK_SECRETS=1 降级为警告。
function validateSecrets() {
  const problems = [];
  if (env.jwtSecret === DEFAULT_JWT_SECRET) {
    problems.push('JWT_SECRET 未配置（正在使用缺省值，任何人都能伪造登录令牌）');
  }
  if (env.adminPassword === DEFAULT_ADMIN_PASSWORD) {
    problems.push(`ADMIN_PASSWORD 未配置或为弱默认密码 ${DEFAULT_ADMIN_PASSWORD}`);
  }
  if (problems.length === 0) return;

  const msg = '安全检查未通过：\n  - ' + problems.join('\n  - ') +
    '\n请在项目根目录 .env 中配置强随机值，例如：\n  JWT_SECRET=<随机长字符串>\n  ADMIN_PASSWORD=<强密码>';
  if (process.env.ALLOW_WEAK_SECRETS === '1') {
    console.warn('⚠️  ' + msg + '\n（ALLOW_WEAK_SECRETS=1，仅警告不退出）');
    return;
  }
  console.error('❌ ' + msg);
  process.exit(1);
}

module.exports = { env, validateSecrets };
