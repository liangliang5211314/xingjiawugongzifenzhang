const path = require('path');

const env = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'app.db'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123456',

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

module.exports = { env };
