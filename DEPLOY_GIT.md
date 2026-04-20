# Git 部署流程

推荐流程：

1. 本地修改代码
2. `git add .`
3. `git commit -m "你的更新说明"`
4. `git push`
5. 服务器执行 `git pull`
6. 服务器执行 `npm install`
7. 服务器执行 `pm2 restart xingjiawugongzi`

## 初始化本地仓库

```bash
git init
git add .
git commit -m "init: multi-team settlement system"
```

## 绑定远程仓库

```bash
git remote add origin <你的仓库地址>
git branch -M main
git push -u origin main
```

## 服务器首次部署

```bash
cd /www/wwwroot
git clone <你的仓库地址> xingjiawugongzi
cd xingjiawugongzi
npm install
cp .env.example .env
mkdir -p data
node src/database/init.js
pm2 start src/server.js --name xingjiawugongzi
pm2 save
```

## 服务器后续更新

```bash
cd /www/wwwroot/xingjiawugongzi
git pull
npm install
pm2 restart xingjiawugongzi
```

## 注意事项

- 不要提交 `node_modules`
- 不要提交 `.env`
- 不要提交 `data/app.db`
- 服务器上的 `.env` 和数据库只保留在线上
