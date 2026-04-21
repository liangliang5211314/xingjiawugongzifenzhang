#!/bin/bash
# 首次部署初始化脚本 — 服务器上只需执行一次
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "===== 首次初始化 ====="
cd "$APP_DIR"

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "安装 Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
  echo "安装 PM2..."
  npm install -g pm2
fi

echo "[1/4] 安装依赖..."
npm install --omit=dev

echo "[2/4] 创建数据目录..."
mkdir -p data

echo "[3/4] 检查 .env 文件..."
if [ ! -f ".env" ]; then
  echo "未找到 .env 文件，根据 .env.example 创建..."
  cp .env.example .env
  echo ""
  echo "⚠️  请编辑 .env 文件填写配置后，重新运行此脚本或运行 deploy.sh"
  echo "    nano .env"
  exit 1
else
  echo ".env 文件已存在，跳过"
fi

echo "[4/4] 初始化数据库 & 启动服务..."
node src/database/init.js
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash 2>/dev/null || true

echo ""
echo "===== 初始化完成 ====="
pm2 status
echo ""
echo "访问地址：$(grep BASE_URL .env | cut -d= -f2)"
