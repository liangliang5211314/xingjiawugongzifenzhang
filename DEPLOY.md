# 服务器部署说明

适用于没有 Docker 的 Linux 服务器，推荐使用：

- Node.js 20
- PM2
- Nginx

## 1. 安装 Node.js

推荐 Node.js 20。

Ubuntu 示例：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

## 2. 上传项目到服务器

把整个项目上传到例如：

```bash
/var/www/team-settlement-system
```

进入项目目录：

```bash
cd /var/www/team-settlement-system
```

## 3. 安装依赖

```bash
npm install
```

## 4. 配置环境变量

复制环境文件：

```bash
cp .env.example .env
```

编辑 `.env`，建议至少设置：

```env
PORT=3000
JWT_SECRET=please-change-this-secret
DB_PATH=/var/www/team-settlement-system/data/app.db
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123456
```

确保数据目录存在：

```bash
mkdir -p data
```

## 5. 初始化数据库

```bash
node src/database/init.js
```

## 6. 启动服务

### 方式 A：直接启动

```bash
npm start
```

### 方式 B：使用 PM2，推荐

先安装 PM2：

```bash
sudo npm install -g pm2
```

启动应用：

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

查看状态：

```bash
pm2 status
pm2 logs team-settlement-system
```

## 7. 配置 Nginx

项目已提供示例配置：

- `deploy/nginx.conf`

把它复制到：

```bash
/etc/nginx/sites-available/team-settlement-system
```

然后修改：

```nginx
server_name your-domain.com;
```

启用站点：

```bash
sudo ln -s /etc/nginx/sites-available/team-settlement-system /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

如果没有域名，也可以先用服务器 IP 访问。

## 8. 开放端口

如果服务器开启了防火墙，放行：

```bash
sudo ufw allow 80
sudo ufw allow 443
```

如果你暂时不配 Nginx，也至少放行 Node 端口：

```bash
sudo ufw allow 3000
```

## 9. HTTPS

有域名后推荐使用 Certbot：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 10. 访问方式

### 不经过 Nginx

```text
http://服务器IP:3000
```

### 经过 Nginx

```text
http://你的域名
```

## 11. 更新发布

以后更新代码后：

```bash
cd /var/www/team-settlement-system
npm install
pm2 restart team-settlement-system
```
