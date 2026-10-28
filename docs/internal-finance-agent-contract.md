# 性价屋财务 Agent · 统一微信入口契约 v1

此契约最初在本地实现与测试阶段编写；后续上线和微信接入以接通任务的验收记录为准。统一入口由 `xingjiawu-zhuanfa` 维护，复用助理2现有登录、接收桥、消息分流和发送队列。财务项目不新建微信监听，也不调用个人微信发送 API。`wechat-push-service.js` 继续只做原公众号模板推送。

## 请求与认证

`POST /api/internal/agent/chat`，JSON，最大 64KB。专用凭据通过 `Authorization: Bearer <FINANCE_AGENT_SERVICE_TOKEN>` 提交，至少 32 字符，与 JWT_SECRET、旧微信桥凭据及模型密钥独立。`FINANCE_AGENT_ACCOUNT_ID` 必须配置为已核实的助理2账号。缺少配置时关闭新接口；本地测试使用合成凭据。不得在请求中传角色、数据库权限或业务 Agent 的聊天记录。

运行时也支持私有 `data/finance-agent-chat.json`（或 FINANCE_AGENT_CHAT_CONFIG 指定路径），字段 token / account_id / owner_id / base_url；文件不入库，环境变量可覆盖身份及凭据。`POST /api/internal/agent/scope` 只返回接收桥必要的账号、群与已绑定私聊 ID，不返回财务角色、账目或聊天历史。`POST /api/internal/agent/authorize-response` 在发送前重新校验原 request_id、本人、会话与权限，返回 allowed 和已缓存响应摘要；不是再次执行聊天请求。

```json
{
  "request_id": "wx-msg-unique-001",
  "agent_id": "finance",
  "account_id": "wxid_assistant2_example",
  "from_user": "wxid_sender_example",
  "conversation_id": "wechat:private:wxid_sender_example",
  "group_id": "",
  "text": "Z团队2026-10收入是多少",
  "received_at": "2026-10-28T08:00:00+08:00"
}
```

以上身份值为合成示例，接入时使用真实稳定 ID 和当前接收时间。字段必需；私聊 group_id 为空字符串。接收时间须带时区。新请求最多滞后 15 分钟，未来最多 2 分钟；同 request_id、相同请求重试返回原结果，不重复创建确认单或任务。相同编号改内容返回 409。权限或绑定发生变化后旧响应不再重放。

可选 `command` 用于统一入口结构化解析，其类型为 summary / expenses / salary / anomalies / create_record / update_record / recalculate / publish_settlement。常用查询、“那上个月呢”“Z团队呢”、提醒开关和确认/取消也支持直接 text。command 是提案，不能绕过财务身份、字段校验、预览和确认。

普通查询由现有 DeepSeek 理解自然语言，例如“今年十月z组进了多少”“那就换成前一个月”。不要求用户输入 YYYY-MM。模型只接收用户本条原文、北京时间日期、当前人的可访问团队 id/名称，以及本财务会话的团队/月/查询类型，不接收账本、成员工资、业务聊天记录或密钥。理解服务复用统一入口已有模型配置，固定调用 `https://zf.xingjiawu.cn/api/finance-agent/interpret`，使用独立聊天服务凭据；不在财务项目复制模型密钥。

模型仅返回 summary / expenses / salary / anomalies 的团队及月份，或要求补问；财务端再次核对实际权限，再用原服务查询金额。未知团队、额外金额字段和写操作计划不会执行。缺年份沿用财务上下文年份或当前年份；本月按北京时间，前一个月相对会话月份。明确查询未提月份时沿用上下文或本月，回复始终写明实际年月。团队或月份存在多个候选时简短追问。理解服务限时失败后仍可用本地常用说法识别；不会因此自动执行写操作。响应可含 `understanding_source: deepseek / rules`，供后台核验，不发送给微信用户。原 request_id 和原文用于幂等，重复请求复用已保存答案，不重复调用模型。

```json
{
  "type": "create_record",
  "team_id": 1,
  "month": "2026-10",
  "fields": {
    "person_name": "崔海亮",
    "item_type": "expense",
    "item_name": "服务器",
    "amount": "528.00",
    "payer_name": "崔海亮",
    "note": "10月服务器"
  }
}
```

金额使用元的十进制字符串，最多两位小数。create_record 仅收入/支出；update_record 必须 record_id，仅允许 amount / item_name / payer_name / note，不借修改移动团队、月份或归属人。金额转换、台账写入与结算全部复用现有服务；禁止聊天 Agent 另算分账公式。删除、批量操作、改公式、自动转账、模型自动猜身份以及图片附件协议不在本接口 v1 范围，必须给出人工处理或补充输入提示。

无需 command 的收支对话也支持明确字段格式：`新增支出 团队=Z团队 月份=2026-10 成员=崔海亮 项目=服务器 金额=528 垫付人=崔海亮 备注=续费`；修改示例：`修改支出 编号=42 金额=600 备注=续费更正`。字段不足就补问，不从昵称或模糊口语猜垫付人；不把模糊指令自动执行。自由口语的复杂解析可由入口提供结构化提案，但确认与权限由财务端掌握。

## 统一返回

```json
{
  "request_id": "wx-msg-unique-001",
  "status": "needs_confirmation",
  "message": "【性价屋·财务】……请回复确认 单号或取消 单号。",
  "task_id": "",
  "detail_url": "",
  "confirmation_id": "财务待确认单号"
}
```

status 固定为 answered / need_input / needs_confirmation / running / failed。task_id、detail_url 无值时为空字符串；confirmation_id 只在需要时出现。detail_url 仅指向本项目已存在的页面，不伪造任务详情链接。响应不包含凭据、完整聊天记录或原始数据库行。

HTTP：200 为正常业务分支（包括权限不足的简明 failed）；400 为契约字段错误；401 为服务凭据错误；409 为请求编号冲突；503 为服务配置缺失或内部不可用。错误同样返回统一结构，不外泄堆栈。响应 Cache-Control: no-store。

## 身份、权限与对话

- 绑定通过已有管理员 JWT 的 `GET/POST /api/finance-agent/chat-bindings` 管理。绑定 account_id + from_user → 本项目 user_id，支持停用；改绑必须带 previous_user_id。首次默认关闭主动提醒。旧群昵称绑定不自动升级成新接口权限。
- 每次请求、确认、任务查询及提醒交付重新读取账号状态与团队权限。管理员读写所有启用团队；队长只管理既有权限代码授予的团队；普通成员只查所属团队自己的收入和工资，不查他人，不操作团队台账或结算。
- 财务上下文按发送者、会话、群、绑定版本隔离，只存团队、月份与查询类型。切换业务 Agent 不迁移财务待确认状态。统一入口先确定归属，一条消息仅分派一次；跨域查询由入口拆分后汇总。
- 群消息仅提供补充信息/转私聊提示，不返回收支金额与工资明细，也不在群里执行写操作。非财务内容返回 need_input，不能替业务 Agent 抢答。
- “确认/取消/好的”仅作用于当前财务会话唯一待确认事项；有多个时列出单号先问清楚。带单号也必须属于本人、当前会话。否定句不执行。
- 入口收到裸“确认/取消/好的”时，还须检查是否同时存在业务 Agent 与财务 Agent 的待确认事项；有跨 Agent 歧义先问归属，不广播给两个 Agent。财务端只维护自己的确认单，向入口返回 confirmation_id 供路由关联，不读取业务聊天或待办库。
- 新增/修改收支、重算、发布都先展示团队、月份、金额与影响。确认单 15 分钟有效；确认时重新校验权限、绑定和原数据摘要，有变则作废，要求重新预览。发布必须回复“确认发布 单号”；裸确认不会发布，也不会把发布指令套用到收支操作。
- 主人默认 `ZML741213442`（可用 FINANCE_AGENT_OWNER_ID 指定），仍须绑定到具有团队管理权限的真实财务账号。重算后先向主人提交私聊审核提醒；发布只能由主人在私聊发起并确认，默认仅发送各成员自己的明细私聊，不发公共群。

## 后台任务

确认重算/发布后返回 running 与原 task_id。`POST /api/internal/agent/tasks/:task_id/query` 使用相同服务凭据及同样身份信封（text 可为空），按原任务查询，不创建任务。只限原发起人、原会话，且权限仍有效。结果仍用统一结构。任务执行复用现有结算服务；发布仅提交统一出口待发送事项，不调用公众号服务，也不声称已送达。运行中断不自动重复写入或发送。

## 主动提醒交接

提醒使用 `【性价屋·财务】` 前缀，包含团队、月份、问题及真实详情链接。绑定中的 notifications_enabled 和用户聊天“开启提醒/关闭提醒”控制是否交付。财务模块提供 enqueueNotification 供明确的财务事件调用；本轮不新建定时器或扫描微信。

`POST /api/internal/agent/notifications/pull`，服务凭据认证，body `{account_id,limit}`；返回仅具当前财务权限的私聊接收人及最少发送内容。每条包含 notification_id、稳定 delivery_id、agent_id=finance、account_id、recipient_id、group_id=""、message、detail_url、expires_at（2分钟）。统一入口必须用 delivery_id 去重并通过现有发送队列发送。

出口实际发送前调用 `POST /api/internal/agent/notifications/:id/authorize`，body `{account_id,delivery_id}`。只有返回 `allowed:true` 且仍在 expires_at 前才允许发送；这是一次权限核验，不重新领取或创建提醒。关闭开关、撤销团队权限、改绑、任务过期或已回执均禁止再发。单队列必须自己保证同 delivery_id 不被并发执行。

`POST /api/internal/agent/notifications/:id/receipt`，body `{account_id,delivery_id,state}`；state 为 accepted / failed / uncertain。accepted 只代表出口接受，不代表人已收到或阅读。交接后未收到收据则标 uncertain，不自动再次交付；原编号收据可以幂等提交。领取、发送前授权、回执再次核验绑定、提醒开关和财务权限。关闭提醒不影响主动发起的对话回复。没有配置真实 BASE_URL 时不创建主动提醒，不生成占位链接。

统一入口的超时或 503 处理：只回复“【性价屋·财务】财务服务暂不可用，请稍后重试”，不影响业务 Agent 或助理2连接。消息、任务、确认、提醒编号不得改名重试。入口负责发送重试、分流上下文和混合问题聚合；财务服务不连接入口数据库，不共享完整历史或密钥。

## 切换条件

此前已部署的 group/bridge 接口是旧路径，不代表本新契约已上线。正式切换需双方另行联调，并在统一入口保证同一消息只走一条路径，避免旧收图逻辑与新分流重复处理。本轮不改 NAS CLOUD_BASE、不另建助理2监听、不更新生产配置。
