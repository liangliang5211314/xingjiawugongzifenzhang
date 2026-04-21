# 部署文档 — 团队收益结算系统

目标环境：Ubuntu 20.04/22.04 + Node.js 20 + PM2 + Nginx

---

## 一、安装 Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # 应显示 v20.x.x
```

---

## 二、部署代码

```bash
cd /www/wwwroot
git clone <your-repo-url> xingjiawugongzi
cd xingjiawugongzi
npm install --omit=dev
mkdir -p data
```

---

## 三、配置环境变量

```bash
cp .env.example .env
nano .env
```

关键项说明：
- `JWT_SECRET`：随机长字符串，如 `openssl rand -hex 32`
- `DB_PATH`：建议绝对路径，如 `/www/wwwroot/xingjiawugongzi/data/app.db`
- `WX_REDIRECT_URI`：必须与微信公众号后台网页授权域名完全一致
- `BASE_URL`：系统对外域名，如 `https://settle.example.com`

---

## 四、初始化数据库

```bash
npm run db:init
# 输出：已创建管理员账号: admin
#       数据库初始化完成。
```

> 如已有旧数据库，会自动备份为 `app.db.backup-<timestamp>`

---

## 五、配置 PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup
pm2 save
pm2 list
```

---

## 六、配置 Nginx

```nginx
server {
    listen 80;
    server_name settle.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 七、配置 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d settle.example.com
sudo certbot renew --dry-run
```

---

## 八、微信公众号配置

1. 微信公众平台 → 设置与开发 → 基本配置 → 获取 AppID/AppSecret
2. 功能设置 → 网页授权域名 → 填入裸域名（如 `settle.example.com`）
3. 模板消息 → 选择/申请模板 → 获取模板ID → 填入 `WX_TEMPLATE_ID`
   - 建议模板字段：first、keyword1（月份）、keyword2（总收入）、keyword3（应收）、keyword4（差额）、remark

---

## 九、飞书配置

1. 飞书开放平台 → 创建企业自建应用 → 开通「电子表格」读写权限
2. 获取 App ID/Secret → 填入 `.env`
3. 创建飞书电子表格 → 获取 URL 中的 `spreadsheet_token`
4. 创建两个 Sheet → 分别获取 Sheet ID → 填入 `FEISHU_RECORDS_SHEET_ID`/`FEISHU_SETTLEMENTS_SHEET_ID`
5. 在表格内给应用授予编辑权限

---

## 十、SQLite 备份

```bash
# 手动备份
cp data/app.db data/app.db.$(date +%Y%m%d)

# crontab 每日自动备份
crontab -e
0 2 * * * cp /www/wwwroot/xingjiawugongzi/data/app.db /backup/settle-$(date +\%Y\%m\%d).db
```

---

## 十一、补录历史数据

1. 登录后台 → 数据录入页
2. 选择团队，**月份选历史月份**（如 2024-03）
3. 逐条录入 income / tax / expense / adjust
4. 录完 → 结算页 → 选该团队+月份 → 运行结算
5. 结算自动计算年同比（2024-03 会查 2023-03 和 2022-03）

---

## 十二、重新结算 & 重新推送

1. 结算页选择团队+月份 → 运行结算（覆盖原记录）
2. 结算后点「推送微信」→ 仅绑定 openid 的成员会收到推送
3. 推送结果在「推送日志」页查看

---

## 十三、常见问题

| 问题 | 排查 |
|------|------|
| 微信授权失败 | 检查 `WX_REDIRECT_URI` 与微信后台配置是否完全一致 |
| 飞书同步失败 | 检查应用权限、spreadsheet_token、sheet_id |
| 成员看不到收益 | `users.name` 与 `income_records.person_name` 必须完全一致（含空格） |
| 推动后无消息 | 检查成员是否绑定 openid；检查 `WX_TEMPLATE_ID` 是否正确 |
| 重启后数据丢失 | 确认 `DB_PATH` 绝对路径正确；检查 `data/` 目录写权限 |
