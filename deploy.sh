#!/bin/bash
# 一键部署脚本 — 在服务器上执行
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="team-settlement-system"

echo "===== 开始部署 ====="
cd "$APP_DIR"

echo "[1/4] 拉取最新代码..."
git pull origin main

echo "[2/4] 安装依赖..."
npm install --omit=dev

echo "[3/4] 初始化/迁移数据库..."
node src/database/init.js

echo "[4/4] 重启服务..."
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 restart "$APP_NAME"
else
  pm2 start ecosystem.config.js
  pm2 save
fi

echo "===== 部署完成 ====="
pm2 status "$APP_NAME"
