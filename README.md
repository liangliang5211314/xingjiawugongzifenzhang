# 多团队分账系统

基于 `Node.js + Express + SQLite + Docker` 的多团队分账系统，支持：

- 多团队隔离结算
- 管理员汇总统计
- `admin` / `team_user` 基础 RBAC
- 标准模式 / `Z` 团队模式 / 自定义 JSON 规则
- 金额统一按分存储，避免 `0.01` 精度误差

## 后端代码结构

```text
src/
  app.js
  server.js
  config/
    env.js
    database.js
  database/
    init.js
    init.sql
  controllers/
    auth-controller.js
    team-controller.js
    member-controller.js
    record-controller.js
    settlement-controller.js
    stats-controller.js
  middleware/
    auth.js
    error-handler.js
  models/
    team-model.js
    member-model.js
    user-model.js
    record-model.js
    settlement-model.js
  routes/
    index.js
  services/
    auth-service.js
    team-service.js
    member-service.js
    record-service.js
    settlement-service.js
  utils/
    http-error.js
    money.js
    settlement.js
public/
  index.html
  app.js
  styles.css
Dockerfile
docker-compose.yml
```

## 启动

### 本地

```bash
npm install
npm run db:init
npm start
```

### Docker

```bash
docker compose up --build
```

### 无 Docker 的服务器部署

如果服务器没有 Docker，也可以直接部署。

项目已经提供：

- PM2 配置: [ecosystem.config.js](/E:/bianchengxuexi/xingjiawugongzi/ecosystem.config.js)
- Nginx 示例: [deploy/nginx.conf](/E:/bianchengxuexi/xingjiawugongzi/deploy/nginx.conf)
- 部署文档: [DEPLOY.md](/E:/bianchengxuexi/xingjiawugongzi/DEPLOY.md)
- 一键部署: [DEPLOY_ONE_CLICK.md](/E:/bianchengxuexi/xingjiawugongzi/DEPLOY_ONE_CLICK.md)

启动后访问：

- 前端首页: [http://localhost:3000](http://localhost:3000)
- 默认管理员:
  - 用户名: `admin`
  - 密码: `admin123456`

## 核心接口

- `POST /api/login`
- `GET /api/teams`
- `POST /api/teams`
- `PUT /api/teams/:id`
- `GET /api/members?team_id=1`
- `POST /api/members`
- `POST /api/records`
- `POST /api/settle?team_id=1&month=2026-03`
- `GET /api/settlement?team_id=1&month=2026-03`
- `GET /api/stats/year`
- `GET /api/stats/month`

## 如何创建 Z 团队

`Z` 团队规则默认内置了：

- 张明亮拿总收入 `20%`
- 张明亮额外报销支出
- 其他成员平分剩余部分

示例请求：

```bash
curl -X POST http://localhost:3000/api/teams \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Z团队",
    "rule_type": "zteam",
    "rule_config": {
      "leader_member_name": "张明亮",
      "leader_ratio": 0.2,
      "reimburse_expenses": true
    },
    "user": {
      "username": "z_team_user",
      "password": "123456"
    }
  }'
```

再添加成员：

```bash
curl -X POST http://localhost:3000/api/members \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"张明亮","team_id":1,"is_leader":true}'
```

## 如何创建 L 团队（自定义比例）

固定比例模式可用 `custom + fixed-ratios`：

```bash
curl -X POST http://localhost:3000/api/teams \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "L团队",
    "rule_type": "custom",
    "rule_config": {
      "strategy": "fixed-ratios",
      "allocations": [
        { "member_id": 5, "ratio": 0.4 },
        { "member_id": 6, "ratio": 0.35 },
        { "member_id": 7, "ratio": 0.25 }
      ]
    },
    "user": {
      "username": "l_team_user",
      "password": "123456"
    }
  }'
```

如果成员还没创建，也可以先创建团队，再在更新团队时写入成员比例。

## 结算引擎说明

核心函数在 [src/utils/settlement.js](/E:/bianchengxuexi/xingjiawugongzi/src/utils/settlement.js)：

- 按 `team.rule_type` 自动分发算法
- 统一输出：
  - `total_income`
  - `members[].should_get`
  - `members[].actual`
  - `members[].diff`
  - `transfers`

转账路径采用“欠款人 -> 收款人”双指针撮合，得到较少的转账条目。
