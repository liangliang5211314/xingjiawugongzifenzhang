const { createHash, randomBytes } = require('crypto');
const { HttpError } = require('../utils/http-error');
const { applyTeamAccess, canManageTeam } = require('../middleware/auth');
const {settlementMessage,messageParts}=require('./settlement-message');

const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const ID = /^[A-Za-z0-9_.:@-]{1,200}$/;
const PREFIX = '【性价屋·财务】';
const Z_GROUP='19116819870@chatroom',Z_GROUP_NAME='Z团队性价屋对接群';
const WRITES = new Set(['create_record', 'update_record', 'recalculate', 'publish_settlement']);
const QUERIES = new Set(['summary', 'expenses', 'salary', 'anomalies']);
const uid = () => randomBytes(8).toString('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const money = cents => (Number(cents || 0) / 100).toFixed(2);
const safeText = (v, max = 200) => typeof v === 'string' && v.length <= max && !/[\x00-\x08\x0b-\x1f]/.test(v);

function validateEnvelope(input, { query = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, '请求必须为 JSON 对象');
  for (const key of ['request_id', 'account_id', 'from_user', 'conversation_id']) {
    if (!ID.test(input[key] || '')) throw new HttpError(400, `${key} 缺失或格式错误`);
  }
  if (input.agent_id !== 'finance' || typeof input.group_id !== 'string' || input.group_id && !ID.test(input.group_id)) throw new HttpError(400, 'agent_id 或 group_id 无效');
  if (!safeText(input.text, 4000) || !query && !input.text.trim() && !input.command) throw new HttpError(400, 'text 缺失或过长');
  if (typeof input.received_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.received_at) || !Number.isFinite(Date.parse(input.received_at))) throw new HttpError(400, 'received_at 必须为带时区的有效时间');
  const allowed = new Set(['request_id','agent_id','account_id','from_user','conversation_id','group_id','text','received_at','command']);
  if (Object.keys(input).some(k => !allowed.has(k))) throw new HttpError(400, '请求包含未约定字段');
  if (input.command && (typeof input.command !== 'object' || Array.isArray(input.command) || ![...QUERIES, ...WRITES].includes(input.command.type))) throw new HttpError(400, 'command.type 不受支持');
  if (input.command) {
    const command=input.command,keys=['type','team_id','month'];
    if (['create_record','update_record'].includes(command.type))keys.push('fields');
    if (command.type==='update_record')keys.push('record_id');
    if (Object.keys(command).some(k=>!keys.includes(k)))throw new HttpError(400,'command 包含未约定字段');
    for (const key of ['team_id','record_id'])if(command[key]!==undefined&&(!Number.isSafeInteger(command[key])||command[key]<1))throw new HttpError(400,`${key} 必须为正整数`);
    if(command.month!==undefined&&!MONTH.test(command.month))throw new HttpError(400,'month 必须为 YYYY-MM');
  }
  return input;
}

function createAgentChatService({ db, backend, accountId, ownerId = 'ZML741213442', baseUrl = '',
  clock = () => new Date(), schedule = fn => setImmediate(fn), onError = () => {}, interpret }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_chat_bindings (
      account_id TEXT NOT NULL,from_user TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),
      enabled INTEGER NOT NULL,notifications_enabled INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL,
      updated_by INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(account_id,from_user)
    );
    CREATE TABLE IF NOT EXISTS agent_chat_contexts (context_key TEXT PRIMARY KEY,context_json TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_chat_requests (request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,access_hash TEXT NOT NULL,response_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_chat_confirmations (
      id TEXT PRIMARY KEY,context_key TEXT NOT NULL,user_id INTEGER NOT NULL,access_hash TEXT NOT NULL,
      action_json TEXT NOT NULL,source_hash TEXT NOT NULL,status TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_chat_tasks (
      id TEXT PRIMARY KEY,confirmation_id TEXT NOT NULL UNIQUE,context_key TEXT NOT NULL,user_id INTEGER NOT NULL,
      access_hash TEXT NOT NULL,action_json TEXT NOT NULL,status TEXT NOT NULL,message TEXT NOT NULL,
      detail_url TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_chat_notifications (
      id TEXT PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL,from_user TEXT NOT NULL,
      user_id INTEGER NOT NULL,binding_revision INTEGER NOT NULL,team_id INTEGER NOT NULL,month TEXT NOT NULL,
      kind TEXT NOT NULL,message TEXT NOT NULL,detail_url TEXT NOT NULL,state TEXT NOT NULL,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_chat_group_push (
      id INTEGER PRIMARY KEY CHECK(id=1),team_id INTEGER NOT NULL,enabled INTEGER NOT NULL,
      revision INTEGER NOT NULL,updated_by INTEGER NOT NULL,updated_at TEXT NOT NULL
    );
  `);
  const stamp = () => clock().toISOString();
  let publicOrigin='';try{const url=new URL(baseUrl);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)publicOrigin=url.origin;}catch{}
  const response = (request, status, message, extra = {}) => ({ request_id: request.request_id, status,
    message: `${PREFIX}${message}`, task_id: '', detail_url: '', ...extra });
  const binding = (account, sender) => db.prepare('SELECT * FROM agent_chat_bindings WHERE account_id=? AND from_user=?').get(account, sender);
  function actorFor(request) {
    if (!accountId || request.account_id !== accountId) throw new HttpError(403, '托管微信账号不匹配');
    const bound = binding(request.account_id, request.from_user);
    const user = bound?.enabled ? db.prepare('SELECT id,name,role,status,team_id FROM users WHERE id=?').get(bound.user_id) : null;
    if (!user || user.status !== 1) throw new HttpError(403, '微信身份尚未绑定有效财务账号，请联系财务管理员');
    const leaders = db.prepare('SELECT id FROM teams WHERE leader_user_id=? ORDER BY id').all(user.id);
    const actor = applyTeamAccess(user, leaders);
    actor.member_team_ids = [...new Set([user.team_id, ...db.prepare('SELECT team_id FROM user_teams WHERE user_id=?').all(user.id).map(r => r.team_id)].filter(Boolean))];
    actor.binding = bound;
    const teamStates = db.prepare('SELECT id,status FROM teams ORDER BY id').all().filter(t=>canManageTeam(actor,t.id)||actor.member_team_ids.includes(t.id));
    actor.access_hash = hash({ user, memberTeams:actor.member_team_ids, managedTeams:actor.managed_team_ids, teamStates, revision:bound.revision });
    return actor;
  }
  function contextKey(request, actor) {
    return hash({agent:'finance',account:request.account_id,sender:request.from_user,conversation:request.conversation_id,
      group:request.group_id,user:actor.id,revision:actor.binding.revision});
  }
  function assertAccess(actor, teamId, write = false) {
    const team = db.prepare('SELECT * FROM teams WHERE id=? AND status=1').get(Number(teamId));
    if (!team || !(canManageTeam(actor, team.id) || !write && actor.member_team_ids.includes(team.id))) throw new HttpError(403, '无权访问或操作该团队');
    if (!canManageTeam(actor, team.id)) {
      const same = db.prepare(`SELECT count(*) n FROM users u WHERE u.name=? AND u.status=1 AND
        (u.team_id=? OR EXISTS(SELECT 1 FROM user_teams ut WHERE ut.user_id=u.id AND ut.team_id=?))`).get(actor.name, team.id, team.id);
      if (same.n !== 1) throw new HttpError(403, '成员姓名归属不唯一，请管理员核对账号');
    }
    return team;
  }
  function bind(input, adminId) {
    const admin = db.prepare('SELECT role,status FROM users WHERE id=?').get(Number(adminId));
    if (!admin || admin.role !== 'admin' || admin.status !== 1) throw new HttpError(403, '仅有效管理员可管理身份绑定');
    if(!input || typeof input!=='object' || Array.isArray(input))throw new HttpError(400,'绑定请求无效');
    if (input.account_id !== accountId || !ID.test(input.from_user || '')) throw new HttpError(400, '绑定微信账号不匹配');
    const user = db.prepare('SELECT id,status FROM users WHERE id=?').get(Number(input.user_id));
    if (!user || user.status !== 1) throw new HttpError(400, '请选择有效财务账号');
    const old = binding(input.account_id, input.from_user);
    if (old && old.user_id !== user.id && Number(input.previous_user_id) !== old.user_id) throw new HttpError(409, '改绑须明确原 user_id');
    for (const key of ['enabled','notifications_enabled']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new HttpError(400, '开关须为布尔值');
    db.prepare(`INSERT INTO agent_chat_bindings VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account_id,from_user) DO UPDATE SET
      user_id=excluded.user_id,enabled=excluded.enabled,notifications_enabled=excluded.notifications_enabled,
      revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(accountId,input.from_user,user.id,input.enabled === false ? 0 : 1,input.notifications_enabled === true ? 1 : 0,(old?.revision || 0)+1,adminId,stamp());
    return binding(accountId,input.from_user);
  }
  function fresh(request) {
    const age = clock().getTime() - Date.parse(request.received_at);
    if (age > 900000 || age < -120000) throw new HttpError(400, '消息已过期或接收时间异常，请重新发起');
  }
  function link(actor, kind) {
    return publicOrigin ? new URL(actor.role === 'admin' || actor.is_team_leader ? (kind === 'record' ? '/admin/records' : '/admin/settlement') : '/h5/home',publicOrigin).href : '';
  }
  function sourceHash(teamId, month) {
    const saved=db.prepare('SELECT * FROM settlements WHERE team_id=? AND month=?').get(teamId,month);
    if(saved){delete saved.pushed_at;delete saved.updated_at;}
    return hash({team:db.prepare('SELECT id,name,rule_type,rule_config,status,leader_user_id,report_member_names FROM teams WHERE id=?').get(teamId),
      records:db.prepare('SELECT * FROM income_records WHERE team_id=? AND month=? ORDER BY id').all(teamId,month),
      settlement:saved,
      rules:db.prepare('SELECT * FROM team_rule_members WHERE team_id=? ORDER BY id').all(teamId),
      users:db.prepare(`SELECT id,name,status,jd_account FROM users u WHERE u.team_id=? OR EXISTS
        (SELECT 1 FROM user_teams ut WHERE ut.user_id=u.id AND ut.team_id=?) ORDER BY id`).all(teamId,teamId)});
  }
  function groupPolicy(teamId){
    const config=db.prepare('SELECT * FROM agent_chat_group_push WHERE id=1').get();
    if(!config?.enabled||teamId&&Number(teamId)!==config.team_id)return null;
    const team=db.prepare('SELECT id,name FROM teams WHERE id=? AND status=1').get(config.team_id);
    return team?.name==='性价屋Z团队'?{...config,group_id:Z_GROUP,group_name:Z_GROUP_NAME,team_name:team.name}:null;
  }
  function groupPushStatus(){const row=db.prepare('SELECT * FROM agent_chat_group_push WHERE id=1').get();return {enabled:!!groupPolicy(),team_id:row?.team_id||null,group_id:Z_GROUP,group_name:Z_GROUP_NAME};}
  function configureGroupPush(input,userId){
    if(!input||typeof input.enabled!=='boolean'||Object.keys(input).some(k=>k!=='enabled'))throw new HttpError(400,'请选择是否开启群推送');
    const actor=actorFor({account_id:accountId,from_user:ownerId});
    if(actor.id!==Number(userId))throw new HttpError(403,'请由主人本人设置群推送');
    const teams=db.prepare("SELECT id FROM teams WHERE name='性价屋Z团队' AND status=1").all();
    if(teams.length!==1)throw new HttpError(400,'请先核对 Z团队信息');assertAccess(actor,teams[0].id,true);
    const old=db.prepare('SELECT * FROM agent_chat_group_push WHERE id=1').get();
    if(!!old?.enabled===input.enabled&&old?.team_id===teams[0].id)return groupPushStatus();
    db.transaction(()=>{
      db.prepare('INSERT INTO agent_chat_group_push VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET team_id=excluded.team_id,enabled=excluded.enabled,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
        .run(teams[0].id,input.enabled?1:0,(old?.revision||0)+1,actor.id,stamp());
      if(input.enabled)db.prepare('UPDATE agent_chat_bindings SET notifications_enabled=1 WHERE account_id=? AND from_user=?').run(accountId,ownerId);
      else db.prepare("UPDATE agent_chat_notifications SET state='suppressed',updated_at=? WHERE kind IN ('group_review','group_settlement') AND state='queued'").run(stamp());
    }).immediate();return groupPushStatus();
  }
  function parse(request, previous) {
    if (request.command) return { ...request.command };
    const text = request.text.trim().replace(/^财务\s*[:：]?\s*/,'').replace(/^(确认|取消)财务\s*/,'$1 ');
    if (/不要|不需要|不想|别(?:重算|发布|确认|新增|修改)/.test(text)) return {type:'unknown'};
    const confirm = text.match(/^(确认发布|确认|好的?|取消)(?:\s+([a-f0-9]{16}))?[。！!\s]*$/);
    if (confirm) return {type:confirm[1] === '取消' ? 'cancel' : 'confirm',id:confirm[2],publish:confirm[1]==='确认发布'};
    if (/^(开启|关闭)(?:财务)?提醒[。！!\s]*$/.test(text)) return {type:'reminders',enabled:text.startsWith('开启')};
    let type;
    if (/重算|重新结算/.test(text)) type='recalculate';
    else if (/发布.*结算|结算.*发布/.test(text)) type='publish_settlement';
    else if (/^新增(?:收入|支出)/.test(text)) type='create_record';
    else if (/^修改(?:收入|支出)/.test(text)) type='update_record';
    else if (/异常|重复|对账/.test(text)) type='anomalies';
    else if (/工资|分账|分成|应收|结算/.test(text)) type='salary';
    else if (/支出|开销|费用|垫付|垫的钱/.test(text)) type='expenses';
    else if (/收入|收益|收支|统计|进账|进了多少|赚了多少/.test(text)) type='summary';
    else if (previous.type && /^(?:那|那么)?(?:上个?月|前一个月|本月|这个月|(?:今年|去年)?[一二三四五六七八九十\d]{1,3}月份?|[ZYLMF](?:团队|队|组)|性价屋[ZYLMF]团队)(?:呢|的呢)?[？?。\s]*$/i.test(text)) type=previous.type;
    else return {type:'unknown'};
    const action={type,team_id:previous.team_id,month:previous.month};
    if (['create_record','update_record'].includes(type)) {
      const matches=[...text.matchAll(/(团队|月份|成员|姓名|项目|金额|垫付人|垫付|备注|编号)\s*[=:：]\s*/g)],labels={};
      for(let i=0;i<matches.length;i++)labels[matches[i][1]]=text.slice(matches[i].index+matches[i][0].length,matches[i+1]?.index??text.length).trim().replace(/[，,;；]+$/,'').trim();
      const map={成员:'person_name',姓名:'person_name',项目:'item_name',金额:'amount',垫付人:'payer_name',垫付:'payer_name',备注:'note'};
      action.fields={};for(const [label,key] of Object.entries(map))if(labels[label]!==undefined)action.fields[key]=labels[label];
      if(action.fields.amount)action.fields.amount=action.fields.amount.replace(/元$/,'').trim();
      if(type==='create_record'){
        action.fields.item_type=text.startsWith('新增支出')?'expense':'income';
        if(!action.fields.person_name||!action.fields.item_name||!action.fields.amount||action.fields.item_type==='expense'&&!action.fields.payer_name)return {type:'write_help'};
      }else{
        if(!/^\d+$/.test(labels.编号||'')||!Object.keys(action.fields).length||action.fields.person_name)return {type:'write_help'};
        action.record_id=Number(labels.编号);
        const record=db.prepare('SELECT team_id,month FROM income_records WHERE id=?').get(action.record_id);
        if(record){action.team_id=record.team_id;action.month=record.month;}
      }
    }
    const lower=text.toLowerCase();
    const matched=db.prepare('SELECT id,name FROM teams').all().filter(t=>{
      const name=t.name.toLowerCase(),short=name.replace(/^性价屋/,'');
      return lower.includes(name)||lower.includes(short)||/^[a-z]团队$/.test(short)&&new RegExp(short[0]+'(?:队|组)(?![a-z])','i').test(lower);
    });
    if (matched.length > 1) return {type:'ambiguous'};
    if (matched.length) action.team_id=matched[0].id;
    const explicit=text.match(/(20\d{2})[-年](\d{1,2})月?/);
    if (explicit) action.month=`${explicit[1]}-${explicit[2].padStart(2,'0')}`;
    const now=new Date(clock().getTime()+8*3600000);
    if (/上个?月|前一个月/.test(text)) {
      const anchor = previous.month && MONTH.test(previous.month) ? previous.month : now.toISOString().slice(0,7);
      const date=new Date(`${anchor}-01T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()-1);action.month=date.toISOString().slice(0,7);
    } else if (/本月|这个月/.test(text)) action.month=now.toISOString().slice(0,7);
    else if(!explicit && QUERIES.has(type)){
      const named=text.match(/(?:^|[^\d])([一二三四五六七八九十]{1,3}|\d{1,2})月份?/);
      if(named){const cn=['','一','二','三','四','五','六','七','八','九','十','十一','十二'],month=/^\d+$/.test(named[1])?Number(named[1]):cn.indexOf(named[1]);
        if(month>=1&&month<=12){let year=Number(text.match(/(20\d{2})年/)?.[1]||(previous.month||now.toISOString()).slice(0,4));if(/今年|去年|前年/.test(text))year=now.getUTCFullYear()-(/前年/.test(text)?2:/去年/.test(text)?1:0);action.month=`${year}-${String(month).padStart(2,'0')}`;}}
      else if(!action.month)action.month=now.toISOString().slice(0,7);
    }
    return action;
  }
  function validateFields(actor, action) {
    const fields=action.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new HttpError(400, '请补充收支字段');
    const allowed=action.type === 'create_record' ? ['person_name','item_type','item_name','amount','payer_name','note'] : ['amount','item_name','payer_name','note'];
    if (!Object.keys(fields).length || Object.keys(fields).some(k=>!allowed.includes(k))) throw new HttpError(400, '收支修改包含不支持的字段');
    if (fields.amount !== undefined && (typeof fields.amount !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(fields.amount) || Number(fields.amount)<=0)) throw new HttpError(400, '金额须为正数元字符串，最多两位小数');
    for (const key of ['person_name','item_name','payer_name','note']) if (fields[key] !== undefined && !safeText(fields[key],key==='note'?500:160)) throw new HttpError(400, '收支文字字段无效');
    const names=db.prepare(`SELECT u.name FROM users u WHERE status=1 AND (team_id=? OR EXISTS
      (SELECT 1 FROM user_teams ut WHERE ut.user_id=u.id AND ut.team_id=?))`).all(action.team_id,action.team_id).map(u=>u.name);
    if (action.type==='create_record' && (!['income','expense'].includes(fields.item_type) || !fields.amount || !fields.item_name?.trim() || !names.includes(fields.person_name))) throw new HttpError(400, '请补充有效成员、收入/支出类型、项目和金额');
    if (fields.payer_name !== undefined && !names.includes(fields.payer_name)) throw new HttpError(400, '垫付人必须是有效团队成员');
    if (action.type==='create_record' && fields.item_type==='expense' && !fields.payer_name) throw new HttpError(400, '支出必须明确垫付人');
    if (action.type==='update_record') {
      const record=db.prepare('SELECT * FROM income_records WHERE id=? AND team_id=? AND month=?').get(Number(action.record_id),action.team_id,action.month);
      if (!record || !['income','expense'].includes(record.item_type)) throw new HttpError(400, '待修改收支不属于该团队月份或类型不支持');
      action.before=record;
    }
  }
  function query(request, actor, team, action) {
    const manage=canManageTeam(actor,team.id);
    const records=db.prepare('SELECT * FROM income_records WHERE team_id=? AND month=? ORDER BY id').all(team.id,action.month)
      .filter(r=> manage || r.person_name===actor.name || r.item_type==='expense' && r.payer_name===actor.name);
    const heading=`${team.name} · ${action.month}${manage?'':` · ${actor.name}（仅本人）`}`;
    if (action.type==='summary') {
      const total=type=>records.filter(r=>r.item_type===type).reduce((s,r)=>s+(type==='expense'?Math.abs(r.amount):r.amount),0);
      return response(request,'answered',`${heading}\n收入 ¥${money(total('income'))}；支出 ¥${money(total('expense'))}。`,{detail_url:link(actor,'record')});
    }
    if (action.type==='expenses') {
      const expenses=records.filter(r=>r.item_type==='expense');
      return response(request,'answered',`${heading}\n${expenses.slice(0,12).map(r=>`${r.item_name || '未命名'} ¥${money(Math.abs(r.amount))}；垫付 ${r.payer_name || '未明确'}；备注 ${r.note || '无'}`).join('\n') || '无支出记录。'}${expenses.length>12?'\n其余请在详情中查看。':''}`,{detail_url:link(actor,'record')});
    }
    if (action.type==='anomalies') {
      const groups=new Map();for(const r of records){const key=canonical([r.person_name,r.item_type,r.item_name,Math.abs(r.amount)]);groups.set(key,(groups.get(key)||0)+1);}
      const duplicates=[...groups.values()].filter(n=>n>1).length;
      const missing=records.filter(r=>r.item_type==='expense'&&!r.payer_name).length;
      return response(request,'answered',`${heading}\n疑似重复项目 ${duplicates} 组；未明确垫付人的支出 ${missing} 笔。仅作核对提示，不自动改账。`,{detail_url:link(actor,'record')});
    }
    const saved=backend.fetchSettlement(team.id,action.month);
    if (!saved) return response(request,'need_input',`${heading} 尚无已保存结算，请有权限的管理员或队长预览并重算。`);
    const members=(saved.result_json?.members || []).filter(m=>manage || m.name===actor.name);
    return response(request,'answered',`${heading}\n${members.slice(0,12).map(m=>`${m.name}：净分成 ${m.net_share==null?'未拆分':'¥'+Number(m.net_share).toFixed(2)}；垫付 ${m.paid_expense==null?'未拆分':'¥'+Number(m.paid_expense).toFixed(2)}；应收 ¥${Number(m.should_get).toFixed(2)}；实收 ¥${Number(m.actual).toFixed(2)}`).join('\n') || '没有本人的分账记录。'}${members.length>12?'\n其余请查看财务详情。':''}`,{detail_url:link(actor,'settlement')});
  }
  function propose(request, actor, key, team, action) {
    assertAccess(actor,team.id,true);
    if (action.type==='publish_settlement' && request.from_user!==ownerId) return response(request,'need_input','结算发布须由主人在私聊中发起并确认；主人也必须具有该团队财务权限。');
    let preview;
    if (['create_record','update_record'].includes(action.type)) {
      validateFields(actor,action);
      const old=action.before;
      preview=`${action.type==='create_record'?'新增':'修改'}${old?.item_type==='expense'||action.fields.item_type==='expense'?'支出':'收入'}，成员 ${old?.person_name||action.fields.person_name}，项目 ${action.fields.item_name||old?.item_name}，金额 ${old?'¥'+money(Math.abs(old.amount))+' → ':''}¥${action.fields.amount||money(Math.abs(old?.amount))}，垫付 ${action.fields.payer_name||old?.payer_name||'无'}，备注 ${action.fields.note??old?.note??'无'}。仅影响该条台账；已有结算需要另行重算。`;
    } else {
      const data=action.type==='recalculate'?backend.previewSettlement(team.id,action.month):backend.fetchSettlement(team.id,action.month);
      if (!data) return response(request,'need_input','本月尚无结算，请先预览并重算。');
      const group=action.type==='publish_settlement'&&groupPolicy(team.id);
      if(group){action.target='z_group';action.group_revision=group.revision;}
      preview=`${action.type==='recalculate'?'重算并保存本团队本月结算快照；先提交主人私聊审核提醒':group?`通过助理2发布到“${Z_GROUP_NAME}”，内容包括本月收支、全部支出备注、成员分账和转账方案`:'发布已保存结算；仅提交有权限且开启提醒的成员本人私聊事项到统一出口，不发公共群'}。收入 ¥${money(data.total_income)}，支出 ¥${money(data.total_expense)}。\n`+
        (data.result_json?.members || []).map(m=>`${m.name} 应收 ¥${Number(m.should_get).toFixed(2)}`).join('；');
    }
    const id=uid();
    db.prepare('INSERT INTO agent_chat_confirmations VALUES(?,?,?,?,?,?,?,?,?)').run(id,key,actor.id,actor.access_hash,JSON.stringify(action),sourceHash(team.id,action.month),'pending',new Date(clock().getTime()+900000).toISOString(),stamp());
    return response(request,'needs_confirmation',`${team.name} · ${action.month}\n${preview}\n请回复“${action.type==='publish_settlement'?'确认发布':'确认'} ${id}”或“取消 ${id}”。`,{confirmation_id:id});
  }
  function requestGroupReview(saved,{user_id}={}){
    const policy=groupPolicy(saved?.team_id);if(!policy)return {status:'disabled',message:'尚未开启助理2群推送'};
    const actor=actorFor({account_id:accountId,from_user:ownerId});assertAccess(actor,policy.team_id,true);
    if(user_id!==undefined&&actor.id!==Number(user_id))throw new HttpError(403,'请由主人本人发起群推送审核');
    if(!actor.binding.notifications_enabled)return {status:'muted',message:'主人已关闭财务提醒，本次没有发出审核单'};
    const snapshot=sourceHash(policy.team_id,saved.month);
    const published=db.prepare("SELECT source_key,state FROM agent_chat_notifications WHERE team_id=? AND month=? AND kind='group_settlement'").all(policy.team_id,saved.month).find(n=>n.source_key.split(':')[2]===snapshot);
    if(published)return {status:'already_submitted',message:'这份结算已经提交过群推送，请查看发送记录，未重复发送'};
    const request={request_id:'group-review:'+uid(),agent_id:'finance',account_id:accountId,from_user:ownerId,
      conversation_id:'wechat:'+hash([accountId,'',ownerId]).slice(0,40),group_id:'',text:'',received_at:stamp()};
    const key=contextKey(request,actor);
    return db.transaction(()=>{
      const pending=db.prepare("SELECT * FROM agent_chat_confirmations WHERE context_key=? AND user_id=? AND status='pending'").all(key,actor.id)
        .find(c=>{const a=JSON.parse(c.action_json);return a.target==='z_group'&&a.team_id===saved.team_id&&a.month===saved.month&&a.group_revision===policy.revision&&c.source_hash===snapshot&&Date.parse(c.expires_at)>clock().getTime();});
      if(pending)return {status:'awaiting_owner',confirmation_id:pending.id,message:'已提交主人私聊核对，确认发布后助理2会自动发到 Z团队群；未重复发送'};
      const preview=propose(request,actor,key,{id:policy.team_id,name:policy.team_name},{type:'publish_settlement',team_id:policy.team_id,month:saved.month});
      const report=settlementMessage({name:policy.team_name},saved),footer='\n━━━━━━━━━━━━━━━━━━━━\n将通过助理2发到“'+Z_GROUP_NAME+'”。\n请核对完整报告后回复“确认发布 '+preview.confirmation_id+'”；取消请回复“取消 '+preview.confirmation_id+'”。';
      const parts=messageParts(report);parts.forEach((part,i)=>enqueueNotification({source_key:`group-review:${policy.revision}:${snapshot}:${preview.confirmation_id}:${i}`,from_user:ownerId,team_id:policy.team_id,month:saved.month,kind:'group_review',message:`待你核对（${i+1}/${parts.length}）\n${part}${footer}`}));
      return {status:'awaiting_owner',confirmation_id:preview.confirmation_id,message:'已提交主人私聊核对，确认发布后助理2会自动发到 Z团队群'};
    }).immediate();
  }
  function enqueueNotification({source_key,from_user,team_id,month,kind,message}) {
    if (!source_key || !['anomaly','owner_review','settlement','group_review','group_settlement'].includes(kind) || !MONTH.test(month) || !safeText(message,1600)) throw new HttpError(400,'提醒字段无效');
    let actor;
    try {actor=actorFor({account_id:accountId,from_user});assertAccess(actor,team_id,kind!=='settlement');}catch(error){if(error instanceof HttpError)return null;throw error;}
    if (!actor.binding.notifications_enabled || kind==='owner_review' && from_user!==ownerId) return null;
    if(kind.startsWith('group_')&&(!groupPolicy(team_id)||from_user!==ownerId))return null;
    const existing=db.prepare('SELECT id FROM agent_chat_notifications WHERE source_key=?').get(source_key);if(existing)return existing.id;
    const team=db.prepare('SELECT name FROM teams WHERE id=?').get(team_id),id=uid(),detail=link(actor,kind==='anomaly'?'record':'settlement');
    if(!detail)return null;
    const body=`${PREFIX}${team.name} · ${month}\n${message}${detail?'\n详情：'+detail:''}`;
    db.prepare('INSERT INTO agent_chat_notifications VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,source_key,accountId,from_user,actor.id,actor.binding.revision,team_id,month,kind,body,detail,'queued',stamp(),stamp());return id;
  }
  function executeTask(taskId, request) {
    const task=db.prepare('SELECT * FROM agent_chat_tasks WHERE id=?').get(taskId);
    if (!task || task.status!=='running') return;
    try {
      db.transaction(()=>{
        const actor=actorFor(request),action=JSON.parse(task.action_json),confirmation=db.prepare('SELECT * FROM agent_chat_confirmations WHERE id=?').get(task.confirmation_id);
        assertAccess(actor,action.team_id,true);
        if(actor.access_hash!==task.access_hash||confirmation.source_hash!==sourceHash(action.team_id,action.month))throw new HttpError(409,'权限或原数据已变化，请重新预览');
        let message,detail;
        if(action.type==='recalculate'){
          const saved=backend.runSettlement(action.team_id,action.month);detail=link(actor,'settlement');
          if(groupPolicy(action.team_id)){
            const review=requestGroupReview(saved);message=`结算已保存（编号 ${saved.id}）。${review.message}。尚未发到群。`;
          }else{
          const reviewMessage=[`结算待主人审核：收入 ¥${money(saved.total_income)}，支出 ¥${money(saved.total_expense)}。`,
            ...(saved.result_json?.expense_items||[]).slice(0,4).map(e=>`支出 ${String(e.item_name).slice(0,40)} ¥${Number(e.amount).toFixed(2)}；垫付 ${e.payer_name||'未明确'}；备注 ${String(e.note||'无').slice(0,60)}`),
            ...(saved.result_json?.members||[]).slice(0,6).map(m=>`${m.name} 应收 ¥${Number(m.should_get).toFixed(2)}；实收 ¥${Number(m.actual).toFixed(2)}`),
            '尚未向成员发布。请查看财务详情；审核后可私聊发起“发布结算 团队 月份”。'].join('\n').slice(0,1550);
          const notice=enqueueNotification({source_key:`review:${taskId}`,from_user:ownerId,team_id:action.team_id,month:action.month,kind:'owner_review',message:reviewMessage});
          message=`结算已保存（编号 ${saved.id}）；${notice?'主人审核提醒已提交统一出口':'提醒配置、开关或接收权限尚未满足，未提交提醒'}。尚未发布给成员。`;
          }
        }else{
          if(request.from_user!==ownerId)throw new HttpError(403,'只有主人可确认发布');
          const saved=backend.fetchSettlement(action.team_id,action.month);if(!saved)throw new HttpError(409,'结算已不存在');
          if(action.target==='z_group'){
            const policy=groupPolicy(action.team_id);
            if(!policy||policy.revision!==action.group_revision)throw new HttpError(409,'群推送设置已变化，请重新核对');
            if(!actor.binding.notifications_enabled)throw new HttpError(409,'财务提醒已关闭，这次没有发到群');
            const snapshot=sourceHash(action.team_id,action.month);
            const prior=db.prepare("SELECT source_key FROM agent_chat_notifications WHERE kind='group_settlement' AND team_id=? AND month=?").all(action.team_id,action.month).some(n=>n.source_key.split(':')[2]===snapshot);
            if(prior)message='这份结算已提交群推送，未重复发送。';
            else{const parts=messageParts(settlementMessage({name:policy.team_name},saved));
              parts.forEach((part,i)=>{if(!enqueueNotification({source_key:`group-settlement:${policy.revision}:${snapshot}:${confirmation.id}:${i}`,from_user:ownerId,team_id:action.team_id,month:action.month,kind:'group_settlement',message:`已核对的结算（${i+1}/${parts.length}）\n${part}`}))throw new HttpError(409,'群推送设置已变化，这次没有发送');});
              message=`已交给助理2发送到“${Z_GROUP_NAME}”，共 ${parts.length} 条；发送结果仍待确认。`;
            }
            detail=link(actor,'settlement');
          }else{
          let count=0;
          for(const b of db.prepare('SELECT * FROM agent_chat_bindings WHERE account_id=? AND enabled=1 AND notifications_enabled=1').all(accountId)){
            let recipient;try{recipient=actorFor({account_id:accountId,from_user:b.from_user});assertAccess(recipient,action.team_id);}catch(error){if(error instanceof HttpError)continue;throw error;}
            const own=(saved.result_json?.members||[]).find(m=>m.name===recipient.name);if(!own)continue;
            if(enqueueNotification({source_key:`publish:${taskId}:${b.from_user}`,from_user:b.from_user,team_id:action.team_id,month:action.month,kind:'settlement',message:`${own.name}：应收 ¥${Number(own.should_get).toFixed(2)}，实收 ¥${Number(own.actual).toFixed(2)}。主人已审核；如有疑问请私聊财务。`}))count++;
          }
          message=`已提交 ${count} 条成员本人私聊结算通知至统一出口，尚未证明送达。`;detail=link(actor,'settlement');
          }
        }
        db.prepare("UPDATE agent_chat_tasks SET status='answered',message=?,detail_url=?,updated_at=? WHERE id=? AND status='running'").run(message,detail,stamp(),taskId);
      }).immediate();
    }catch(error){
      db.prepare("UPDATE agent_chat_tasks SET status='failed',message=?,updated_at=? WHERE id=? AND status='running'").run(error instanceof HttpError?error.message:'处理失败，请在财务系统核对；没有自动重试',stamp(),taskId);
      if(!(error instanceof HttpError))onError(error);
    }
  }
  function confirm(request, actor, key, choice) {
    db.prepare("UPDATE agent_chat_confirmations SET status='expired' WHERE status='pending' AND expires_at<=?").run(stamp());
    const rows=db.prepare("SELECT * FROM agent_chat_confirmations WHERE context_key=? AND user_id=? AND status='pending' ORDER BY created_at").all(key,actor.id);
    const chosen=choice.id?rows.find(r=>r.id===choice.id):rows.length===1?rows[0]:null;
    if(!chosen)return response(request,'need_input',rows.length>1?`有多个待确认事项：${rows.map(r=>r.id).join('、')}。请明确“确认 单号”或“取消 单号”。`:'当前会话没有对应有效待确认事项；未执行操作。');
    if(choice.type==='cancel'){
      db.prepare("UPDATE agent_chat_confirmations SET status='cancelled' WHERE id=? AND status='pending'").run(chosen.id);
      return response(request,'answered',`已取消 ${chosen.id}，未修改台账或结算。`);
    }
    const action=JSON.parse(chosen.action_json);assertAccess(actor,action.team_id,true);
    if(action.target==='z_group'&&groupPolicy(action.team_id)?.revision!==action.group_revision){db.prepare("UPDATE agent_chat_confirmations SET status='stale' WHERE id=?").run(chosen.id);return response(request,'need_input','群推送设置已变化，请重新核对；这次没有发送。');}
    if(action.type==='publish_settlement'&&!choice.publish)return response(request,'needs_confirmation',`发布须明确回复“确认发布 ${chosen.id}”；本次没有发布。`,{confirmation_id:chosen.id});
    if(action.type!=='publish_settlement'&&choice.publish)return response(request,'need_input','这个单号不是发布审核单，未执行操作。');
    if(actor.access_hash!==chosen.access_hash||chosen.source_hash!==sourceHash(action.team_id,action.month)){
      db.prepare("UPDATE agent_chat_confirmations SET status='stale' WHERE id=?").run(chosen.id);
      return response(request,'need_input','权限、绑定或原数据已变化，原确认作废。请重新发起预览。');
    }
    db.prepare("UPDATE agent_chat_confirmations SET status='confirmed' WHERE id=? AND status='pending'").run(chosen.id);
    if(['create_record','update_record'].includes(action.type)){
      validateFields(actor,action);
      const record=action.type==='create_record'?backend.addRecord({team_id:action.team_id,month:action.month,...action.fields,created_by:actor.id}):backend.editRecord(action.record_id,{...action.fields});
      return response(request,'answered',`收支已保存（编号 ${record.id}），未自动重算或推送。`,{detail_url:link(actor,'record')});
    }
    const taskId=uid();db.prepare('INSERT INTO agent_chat_tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(taskId,chosen.id,key,actor.id,actor.access_hash,JSON.stringify(action),'running','任务已受理','',stamp(),stamp());
    // Scheduling happens after the request transaction commits (see chat).
    return response(request,'running','任务已受理；请按原任务编号查询进度，不要重新提交。',{task_id:taskId});
  }
  function chat(input, resolved) {
    const request=validateEnvelope(input),actor=actorFor(request),key=contextKey(request,actor);
    const accessHash=hash([actor.access_hash,key]);
    const old=db.prepare('SELECT * FROM agent_chat_requests WHERE request_id=?').get(request.request_id);
    if(old){if(old.payload_hash!==hash(request))throw new HttpError(409,'request_id 已用于其他消息');if(old.access_hash!==accessHash)throw new HttpError(409,'权限或绑定已变化，旧响应不能重放');return JSON.parse(old.response_json);}
    fresh(request);
    const result=db.transaction(()=>{
      let result;
      const previous=JSON.parse(db.prepare('SELECT context_json FROM agent_chat_contexts WHERE context_key=?').get(key)?.context_json||'{}');
      const action=resolved?.action || parse(request,previous);
      if(request.group_id) result=response(request,'need_input','为保护财务隐私，请私聊助理2继续查询或确认；本群不返回工资明细或执行写操作。');
      else if(['confirm','cancel'].includes(action.type))result=confirm(request,actor,key,action);
      else if(action.type==='reminders'){
        db.prepare('UPDATE agent_chat_bindings SET notifications_enabled=?,updated_at=? WHERE account_id=? AND from_user=?').run(action.enabled?1:0,stamp(),accountId,request.from_user);
        if(!action.enabled)db.prepare("UPDATE agent_chat_notifications SET state='suppressed',updated_at=? WHERE account_id=? AND from_user=? AND state='queued'").run(stamp(),accountId,request.from_user);
        result=response(request,'answered',`主动财务提醒已${action.enabled?'开启':'关闭'}；不影响你主动查询。`);
      }else if(![...QUERIES,...WRITES].includes(action.type))result=response(request,'need_input',action.type==='write_help'?'这笔收支属于哪个团队、哪个月？请再告诉我成员、项目、金额；支出还需要说明谁垫付。保存前会先给你核对。':action.type==='ambiguous'||action.missing==='team'?'你想查哪个团队？请选一个，我接着查。':action.missing==='month'?'你想查哪个月？说“十月”或“上个月”就可以。':'你想了解收入、支出，还是成员分账？直接说就可以。');
      else{
        if(!action.team_id){const teams=db.prepare('SELECT id FROM teams WHERE status=1').all().filter(t=>canManageTeam(actor,t.id)||actor.member_team_ids.includes(t.id));if(teams.length===1)action.team_id=teams[0].id;}
        if(!action.team_id || !MONTH.test(action.month)){
          if(QUERIES.has(action.type))db.prepare('INSERT INTO agent_chat_contexts VALUES(?,?,?) ON CONFLICT(context_key) DO UPDATE SET context_json=excluded.context_json,updated_at=excluded.updated_at').run(key,JSON.stringify({type:action.type,...(MONTH.test(action.month)?{month:action.month}:{})}),stamp());
          result=response(request,'need_input',!action.team_id?'你想查哪个团队？比如说“Z团队”，我接着查。':'你想查哪个月？说“十月”或“上个月”就可以。');
        }
        else{
          action.team_id=Number(action.team_id);const team=assertAccess(actor,action.team_id,WRITES.has(action.type));
          db.prepare('INSERT INTO agent_chat_contexts VALUES(?,?,?) ON CONFLICT(context_key) DO UPDATE SET context_json=excluded.context_json,updated_at=excluded.updated_at').run(key,JSON.stringify({team_id:team.id,month:action.month,type:QUERIES.has(action.type)?action.type:'salary'}),stamp());
          result=WRITES.has(action.type)?propose(request,actor,key,team,action):query(request,actor,team,action);
        }
      }
      if(resolved?.source)result.understanding_source=resolved.source;
      db.prepare('INSERT INTO agent_chat_requests VALUES(?,?,?,?,?)').run(request.request_id,hash(request),accessHash,JSON.stringify(result),stamp());return result;
    }).immediate();
    if(result.status==='running')schedule(()=>executeTask(result.task_id,request));
    return result;
  }
  // Understanding only resolves a read scope. Permissions, amounts and every
  // write still pass through the same synchronous ledger path above.
  const understanding=new Map();
  async function respond(input){
    const request=validateEnvelope(input),actor=actorFor(request),key=contextKey(request,actor);fresh(request);
    if(db.prepare('SELECT 1 FROM agent_chat_requests WHERE request_id=?').get(request.request_id))return chat(request);
    const previous=JSON.parse(db.prepare('SELECT context_json FROM agent_chat_contexts WHERE context_key=?').get(key)?.context_json||'{}');
    const parsed=parse(request,previous);
    if(request.command||request.group_id||!interpret||!['unknown',...QUERIES].includes(parsed.type)||/不要|不需要|不想|别(?:重算|发布|确认|新增|修改)/.test(request.text))return chat(request);
    if(parsed.team_id)assertAccess(actor,parsed.team_id);
    const pending=understanding.get(request.request_id);
    if(pending){if(pending.hash!==hash(request))throw new HttpError(409,'request_id 已用于其他消息');await pending.work;return chat(request);}
    const work=(async()=>{
      let action,source='rules';
      try{
        const teams=db.prepare('SELECT id,name FROM teams WHERE status=1').all().filter(t=>canManageTeam(actor,t.id)||actor.member_team_ids.includes(t.id));
        const plan=await interpret({text:request.text,today:new Date(clock().getTime()+8*3600000).toISOString().slice(0,10),previous,teams});
        if(plan?.type==='clarify' && ['team','month','intent'].includes(plan.missing) && Object.keys(plan).every(k=>['type','missing'].includes(k))){
          action=plan.missing==='team'&&QUERIES.has(parsed.type)?{...parsed,team_id:undefined}:{...plan};source='deepseek';
        }
        else if(plan && QUERIES.has(plan.type) && Number.isSafeInteger(plan.team_id) && teams.some(t=>t.id===plan.team_id) && (!parsed.team_id||plan.team_id===parsed.team_id) && MONTH.test(plan.month) && Object.keys(plan).every(k=>['type','team_id','month'].includes(k))){
          action={type:plan.type,team_id:plan.team_id,month:plan.month};source='deepseek';
        }
      }catch(error){onError(error);}
      return chat(request,{action,source});
    })();
    understanding.set(request.request_id,{hash:hash(request),work});
    try{return await work;}finally{understanding.delete(request.request_id);}
  }
  function taskStatus(id,input) {
    const request=validateEnvelope(input,{query:true}),actor=actorFor(request);fresh(request);
    const task=db.prepare('SELECT * FROM agent_chat_tasks WHERE id=? AND context_key=? AND user_id=?').get(id,contextKey(request,actor),actor.id);
    if(!task)throw new HttpError(404,'任务不存在或不属于当前会话');
    const action=JSON.parse(task.action_json);assertAccess(actor,action.team_id,true);
    if(task.access_hash!==actor.access_hash)throw new HttpError(403,'任务访问权限已变化');
    return response(request,task.status,task.message,{task_id:id,detail_url:task.detail_url});
  }
  function notificationTarget(row,{receipt=false}={}){
    const actor=actorFor({account_id:accountId,from_user:row.from_user});assertAccess(actor,row.team_id,row.kind!=='settlement');
    if(actor.id!==row.user_id||actor.binding.revision!==row.binding_revision||!actor.binding.notifications_enabled)throw new HttpError(403,'接收权限或提醒开关已变化');
    if(!row.kind.startsWith('group_'))return {recipient_id:row.from_user,group_id:''};
    const policy=groupPolicy(row.team_id),match=row.source_key.match(/^group-(review|settlement):(\d+):([a-f0-9]{64}):([a-f0-9]{16}):(\d+)$/);
    const confirmation=match&&db.prepare('SELECT * FROM agent_chat_confirmations WHERE id=?').get(match[4]);
    if(!policy||!match||match[1]!==row.kind.replace('group_','')||row.from_user!==ownerId||policy.revision!==Number(match[2])||sourceHash(row.team_id,row.month)!==match[3]||!confirmation||confirmation.user_id!==actor.id||confirmation.source_hash!==match[3])throw new HttpError(403,'结算或群推送设置已变化，请重新核对');
    const action=JSON.parse(confirmation.action_json);
    if(action.target!=='z_group'||action.group_revision!==policy.revision||action.team_id!==row.team_id||action.month!==row.month||confirmation.access_hash!==actor.access_hash||
      !(row.kind==='group_review'?(receipt?['pending','confirmed']:['pending']).includes(confirmation.status):confirmation.status==='confirmed')||row.kind==='group_review'&&!receipt&&Date.parse(confirmation.expires_at)<=clock().getTime())throw new HttpError(403,'本次群推送尚未确认或审核已失效');
    return row.kind==='group_review'?{recipient_id:ownerId,group_id:'',confirmation_id:confirmation.id}:{recipient_id:Z_GROUP,group_id:Z_GROUP};
  }
  function pullNotifications({account_id,limit=10} = {}) {
    if(account_id!==accountId)throw new HttpError(403,'托管微信账号不匹配');
    if(!Number.isInteger(limit)||limit<1||limit>20)throw new HttpError(400,'limit 必须为 1–20');
    return db.transaction(()=>{
      db.prepare("UPDATE agent_chat_notifications SET state='uncertain',updated_at=? WHERE state='handed_off' AND updated_at<?").run(stamp(),new Date(clock().getTime()-120000).toISOString());
      const rows=db.prepare("SELECT * FROM agent_chat_notifications WHERE account_id=? AND state='queued' ORDER BY created_at,id LIMIT ?").all(accountId,limit),items=[];
      for(const row of rows){
        let target;try{target=notificationTarget(row);}catch(error){if(!(error instanceof HttpError))throw error;}
        const valid=!!target;
        db.prepare('UPDATE agent_chat_notifications SET state=?,updated_at=? WHERE id=?').run(valid?'handed_off':'suppressed',stamp(),row.id);
        if(valid)items.push({notification_id:row.id,delivery_id:`finance:${row.id}`,agent_id:'finance',account_id:accountId,...target,message:row.message,detail_url:row.detail_url,expires_at:new Date(clock().getTime()+120000).toISOString()});
      }
      return {items};
    }).immediate();
  }
  function notificationReceipt(id,{account_id,delivery_id,state} = {}) {
    if(account_id!==accountId||delivery_id!==`finance:${id}`||!['accepted','failed','uncertain'].includes(state))throw new HttpError(400,'发送回执无效');
    const row=db.prepare('SELECT * FROM agent_chat_notifications WHERE id=? AND account_id=?').get(id,accountId);if(!row)throw new HttpError(404,'提醒不存在');
    notificationTarget(row,{receipt:true});
    if(row.state===state)return {notification_id:id,state};
    if(!['handed_off','uncertain'].includes(row.state))throw new HttpError(409,'回执与提醒状态冲突');
    db.prepare('UPDATE agent_chat_notifications SET state=?,updated_at=? WHERE id=?').run(state,stamp(),id);
    if(row.kind==='group_settlement'&&state==='accepted'){
      const prefix=row.source_key.slice(0,row.source_key.lastIndexOf(':')+1);
      const remaining=db.prepare("SELECT 1 FROM agent_chat_notifications WHERE source_key LIKE ? AND state!='accepted'").get(prefix+'%');
      if(!remaining){const saved=backend.fetchSettlement(row.team_id,row.month);backend.markSettlementPushed?.(saved.id);}
    }
    return {notification_id:id,state};
  }
  function authorizeNotification(id,{account_id,delivery_id} = {}) {
    if(account_id!==accountId||delivery_id!==`finance:${id}`)throw new HttpError(403,'发送编号不匹配');
    const row=db.prepare("SELECT * FROM agent_chat_notifications WHERE id=? AND account_id=? AND state='handed_off'").get(id,accountId);
    if(!row || Date.parse(row.updated_at)+120000<=clock().getTime())throw new HttpError(409,'发送授权已过期或状态已变化，不得重发');
    const target=notificationTarget(row);
    return {notification_id:id,delivery_id,allowed:true,...target,message_hash:createHash('sha256').update(row.message).digest('hex')};
  }
  function authorizeResponse(input) {
    const request=validateEnvelope(input,{query:true}),actor=actorFor(request);fresh(request);
    const row=db.prepare('SELECT access_hash,response_json FROM agent_chat_requests WHERE request_id=?').get(request.request_id);
    if(!row||row.access_hash!==hash([actor.access_hash,contextKey(request,actor)]))throw new HttpError(403,'回复权限或会话已变化');
    return {allowed:true,response_hash:createHash('sha256').update(row.response_json).digest('hex')};
  }
  return {chat,respond,taskStatus,bind,pullNotifications,notificationReceipt,authorizeNotification,enqueueNotification,authorizeResponse,
    requestGroupReview,configureGroupPush,groupPushStatus,
    ingressScope:()=>({account_id:accountId,owner_id:ownerId,group_id:'19116819870@chatroom',private_ids:db.prepare(`SELECT b.from_user FROM agent_chat_bindings b JOIN users u ON u.id=b.user_id
      WHERE b.account_id=? AND b.enabled=1 AND u.status=1`).all(accountId).map(r=>r.from_user)}),
    bindings:adminId=>{const admin=db.prepare('SELECT role,status FROM users WHERE id=?').get(Number(adminId));
      if(admin?.role!=='admin'||admin.status!==1)throw new HttpError(403,'仅有效管理员可查看身份绑定');
      return db.prepare('SELECT b.*,u.name,u.role FROM agent_chat_bindings b JOIN users u ON b.user_id=u.id ORDER BY b.updated_at').all();},
    recover:()=>db.prepare("UPDATE agent_chat_tasks SET status='failed',message='服务重启中断任务，请核对账本；未自动重试',updated_at=? WHERE status='running'").run(stamp())};
}
module.exports={createAgentChatService,validateEnvelope};
