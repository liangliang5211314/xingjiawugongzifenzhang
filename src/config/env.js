const path = require("path");

const env = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  dbPath: process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "app.db"),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123456",
  wxAppId: process.env.WX_APPID || "",
  wxSecret: process.env.WX_SECRET || "",
  wxRedirectUri: process.env.WX_REDIRECT_URI || ""
};

module.exports = { env };
