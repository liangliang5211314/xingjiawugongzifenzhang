const assert = require('node:assert/strict');
const {test,beforeEach,after} = require('node:test');
const fs=require('fs');
process.env.DB_PATH=':memory:';
const {db}=require('../src/config/database');
assert.equal(db.name,':memory:','tests must never open the project ledger');
db.exec(fs.readFileSync(require('path').join(__dirname,'../src/database/init.sql'),'utf8'));
db.exec(`ALTER TABLE users ADD COLUMN jd_account TEXT;
 ALTER TABLE teams ADD COLUMN leader_user_id INTEGER;
 ALTER TABLE teams ADD COLUMN report_member_names TEXT;
 ALTER TABLE settlements ADD COLUMN year_compare_prev3 INTEGER;`);
const settlement=require('../src/services/settlement-service');
const recordService=require('../src/services/record-service');
const {getSettlement}=require('../src/models/settlement-model');
const {setRuleMembers}=require('../src/models/team-rule-member-model');
const {createAgentChatService,validateEnvelope}=require('../src/services/agent-chat-service');
const {createInternalAgentRouter}=require('../src/routes/internal-agent');
const express=require('express');
const ACCOUNT='fixture-assistant2',OWNER='ZML741213442';
let service,jobs,now,serial,runCount;
const token='fixture-finance-service-token-32-characters';
function request(text='Z团队2026-10收入',fields={}){
  return {request_id:`fixture-${++serial}`,agent_id:'finance',account_id:ACCOUNT,from_user:OWNER,
    conversation_id:'private-1',group_id:'',text,received_at:now.toISOString(),...fields};
}
function proposal(type='create_record',fields={}){
  return {type,team_id:1,month:'2026-10',fields:{person_name:'崔海亮',item_type:'expense',item_name:'服务器新增',amount:'100.00',payer_name:'崔海亮',note:'真实垫付',...fields}};
}
function count(table){return db.prepare(`SELECT count(*) n FROM ${table}`).get().n;}
function runJobs(){while(jobs.length)jobs.shift()();}
function bind(sender,user,enabled=true,notifications=true,previous){return service.bind({account_id:ACCOUNT,from_user:sender,user_id:user,enabled,notifications_enabled:notifications,previous_user_id:previous},1);}
beforeEach(()=>{
  for(const table of ['agent_chat_notifications','agent_chat_tasks','agent_chat_confirmations','agent_chat_requests','agent_chat_contexts','agent_chat_bindings',
    'income_records','settlements','team_rule_members','user_teams','users','teams']){
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))db.exec(`DELETE FROM ${table}`);
  }
  db.exec(`INSERT INTO teams(id,name,rule_type,rule_config,leader_user_id) VALUES(1,'性价屋Z团队','custom','{}',2),(2,'性价屋L团队','standard','{}',5);
    INSERT INTO users(id,name,role,status,team_id) VALUES(1,'张明亮','admin',1,1),(2,'崔紫阳','member',1,1),(3,'崔如意','member',1,1),(4,'崔海亮','member',1,1),(5,'L队长','member',1,2),(6,'其他成员','member',1,2);
    INSERT INTO user_teams SELECT id,team_id FROM users;
    INSERT INTO income_records(team_id,month,person_name,item_type,item_name,amount,payer_name) VALUES
      (1,'2026-10','崔如意','income','income',1065729,NULL),(1,'2026-10','崔海亮','income','income',42,NULL),(1,'2026-10','崔紫阳','income','income',85992,NULL),
      (1,'2026-10','张明亮','expense','软件',-108000,'张明亮'),(1,'2026-10','崔海亮','expense','服务器',-52800,'崔海亮'),
      (1,'2026-09','崔如意','income','income',181504,NULL),(2,'2026-10','其他成员','income','L收入',899,NULL);`);
  setRuleMembers(1,[{member_name:'崔海亮',rule_mode:'formula',formula:'(income-round(income*0.2)-expense)/3 + paid_expense'},
    {member_name:'张明亮',rule_mode:'formula',formula:'round(income*0.2) + paid_expense'},
    {member_name:'崔如意',rule_mode:'formula',formula:'(income-round(income*0.2)-expense)/3 + paid_expense'},
    {member_name:'崔紫阳',rule_mode:'formula',formula:'(income-round(income*0.2)-expense)/3 + paid_expense'}]);
  settlement.runSettlement(1,'2026-10');
  jobs=[];now=new Date('2026-10-28T08:00:00Z');serial=0;runCount=0;
  service=createAgentChatService({db,accountId:ACCOUNT,ownerId:OWNER,baseUrl:'https://finance.example.invalid',clock:()=>now,schedule:fn=>jobs.push(fn),
    backend:{addRecord:recordService.addRecord,editRecord:recordService.editRecord,fetchSettlement:getSettlement,
      previewSettlement:settlement.previewSettlement,runSettlement:(...args)=>{runCount++;return settlement.runSettlement(...args);}}});
  bind(OWNER,1);bind('wxid-leader',2);bind('wxid-r',3);bind('wxid-h',4);bind('wxid-other',6);
});
after(()=>db.close());

test('envelope validates namespace, identities, time and rejects client-supplied authority',()=>{
  for(const patch of [{agent_id:'business'},{from_user:''},{group_id:null},{received_at:'2026-10-28'},{role:'admin'}])assert.throws(()=>validateEnvelope(request('',patch)));
  assert.throws(()=>service.chat(request('查收入',{from_user:'unknown'})),/尚未绑定/);
  assert.throws(()=>service.chat(request('查收入',{account_id:'another-bot'})),/不匹配/);
  assert.equal(count('agent_chat_requests'),0);
});

test('ordinary member sees only own income and own saved salary',()=>{
  const income=service.chat(request('Z团队2026-10收入',{from_user:'wxid-r'}));
  assert.equal(income.status,'answered');assert.match(income.message,/10657\.29/);assert.doesNotMatch(income.message,/11517\.63|崔海亮|张明亮/);
  const salary=service.chat(request('工资',{from_user:'wxid-r'}));
  assert.match(salary.message,/2535\.37/);assert.doesNotMatch(salary.message,/张明亮|3383\.53|3063\.37/);
  assert.equal(new URL(salary.detail_url).pathname,'/h5/home');
});

test('historical snapshots with no expense breakdown never invent a zero reimbursement',()=>{
  const saved=getSettlement(1,'2026-10'),member=saved.result_json.members.find(m=>m.name==='崔海亮');delete member.paid_expense;delete member.net_share;
  db.prepare('UPDATE settlements SET result_json=? WHERE id=?').run(JSON.stringify(saved.result_json),saved.id);
  const answer=service.chat(request('Z团队2026-10工资',{from_user:'wxid-h'}));assert.match(answer.message,/垫付 未拆分/);assert.doesNotMatch(answer.message,/垫付 ¥0/);
});

test('income adjustments retain their sign while expenses use their absolute value',()=>{
  db.prepare("INSERT INTO income_records(team_id,month,person_name,item_type,item_name,amount) VALUES(1,'2026-10','崔如意','income','收入更正',-5729)").run();
  assert.match(service.chat(request('Z团队2026-10收入')).message,/收入 ¥11460\.34；支出 ¥1608\.00/);
  assert.match(service.chat(request('Z团队2026-10收入',{from_user:'wxid-r'})).message,/收入 ¥10600\.00/);
});

test('team leaders reuse the existing team boundary and cannot manage other teams',()=>{
  const own=service.chat(request('Z团队2026-10收入',{from_user:'wxid-leader'}));assert.match(own.message,/11517\.63/);
  assert.throws(()=>service.chat(request('L团队2026-10收入',{from_user:'wxid-leader'})),/无权/);
  assert.throws(()=>service.chat(request('',{from_user:'wxid-r',command:proposal()})),/无权/);
  const admin=service.chat(request('L团队2026-10收入'));assert.match(admin.message,/8\.99/);
});

test('financial follow-ups retain month and intent, but not another conversation context',()=>{
  service.chat(request('L团队2026-10收入'));
  assert.match(service.chat(request('Z团队呢')).message,/11517\.63/);
  assert.match(service.chat(request('那上个月呢')).message,/2026-09.*\n收入 ¥1815\.04/);
  const other=service.chat(request('那上个月呢',{conversation_id:'other-conversation'}));assert.equal(other.status,'need_input');
  assert.doesNotMatch(other.message,/1815\.04/);
});

test('groups never expose amounts or create confirmation tasks even for administrators',()=>{
  const result=service.chat(request('Z团队2026-10工资',{group_id:'fixture@chatroom'}));
  assert.equal(result.status,'need_input');assert.doesNotMatch(result.message,/3383|10657|¥/);
  service.chat(request('',{group_id:'fixture@chatroom',command:proposal()}));assert.equal(count('agent_chat_confirmations'),0);
});

test('record creation is previewed and confirmed once using the existing record service',()=>{
  const before=count('income_records'),envelope=request('',{command:proposal()});
  const preview=service.chat(envelope);assert.equal(preview.status,'needs_confirmation');assert.match(preview.message,/性价屋Z团队 · 2026-10/);assert.match(preview.message,/¥100.00/);assert.match(preview.message,/崔海亮/);
  assert.equal(count('income_records'),before);
  assert.deepEqual(service.chat(envelope),preview);assert.equal(count('agent_chat_confirmations'),1);
  assert.throws(()=>service.chat({...envelope,text:'different'}),/request_id/);
  const confirm=request('确认 '+preview.confirmation_id),answer=service.chat(confirm);assert.equal(answer.status,'answered');
  assert.equal(count('income_records'),before+1);assert.deepEqual(service.chat(confirm),answer);assert.equal(count('income_records'),before+1);
  const record=db.prepare("SELECT * FROM income_records WHERE item_name='服务器新增'").get();assert.equal(record.amount,10000);assert.equal(record.created_by,1);assert.equal(record.payer_name,'崔海亮');assert.equal(runCount,0);
});

test('updates show before/after and reject changing ownership or teams',()=>{
  const row=db.prepare("SELECT * FROM income_records WHERE item_name='服务器'").get();
  const command={type:'update_record',record_id:row.id,team_id:1,month:'2026-10',fields:{amount:'600.00',note:'续费'}};
  const preview=service.chat(request('',{command}));assert.match(preview.message,/528\.00 → ¥600\.00/);
  service.chat(request('确认 '+preview.confirmation_id));assert.equal(db.prepare('SELECT amount FROM income_records WHERE id=?').get(row.id).amount,60000);
  assert.throws(()=>service.chat(request('',{command:{...command,fields:{team_id:2}}})),/不支持/);
});

test('text-only financial proposals work without an upstream command parser',()=>{
  const p=service.chat(request('新增支出 团队=Z团队 月份=2026-10 成员=崔海亮 项目=服务器 金额=528 垫付人=崔海亮 备注=续费'));
  assert.equal(p.status,'needs_confirmation');assert.match(p.message,/¥528/);assert.match(p.message,/备注 续费/);
  service.chat(request('确认 '+p.confirmation_id));
  const row=db.prepare("SELECT id FROM income_records WHERE note='续费'").get();
  const update=service.chat(request(`修改支出 编号=${row.id} 金额=600 备注=续费更正`));assert.equal(update.status,'needs_confirmation');assert.match(update.message,/2026-10/);
  service.chat(request('确认 '+update.confirmation_id));assert.equal(db.prepare('SELECT amount FROM income_records WHERE id=?').get(row.id).amount,60000);
  assert.equal(service.chat(request('新增支出 528元')).status,'need_input');
});

test('multiple pending items require their exact ID, and negative text never confirms',()=>{
  const a=service.chat(request('',{command:proposal()})),b=service.chat(request('',{command:proposal('create_record',{amount:'200.00'})})),before=count('income_records');
  const ambiguous=service.chat(request('好的'));assert.equal(ambiguous.status,'need_input');assert.match(ambiguous.message,new RegExp(a.confirmation_id));assert.equal(count('income_records'),before);
  service.chat(request('不要确认 '+a.confirmation_id));assert.equal(count('income_records'),before);
  service.chat(request('取消 '+a.confirmation_id));
  service.chat(request('好的'));assert.equal(count('income_records'),before+1);
  assert.equal(db.prepare('SELECT status FROM agent_chat_confirmations WHERE id=?').get(b.confirmation_id).status,'confirmed');
});

test('another user or conversation cannot confirm an item, including when its ID is known',()=>{
  const p=service.chat(request('',{command:proposal()})),before=count('income_records');
  assert.equal(service.chat(request('确认 '+p.confirmation_id,{conversation_id:'other'})).status,'need_input');
  assert.equal(service.chat(request('确认 '+p.confirmation_id,{from_user:'wxid-leader'})).status,'need_input');
  assert.equal(count('income_records'),before);
});

test('source changes, expiration and revoked rights prevent confirmation',()=>{
  const p=service.chat(request('',{command:proposal()}));
  db.prepare("UPDATE income_records SET note='changed' WHERE team_id=1 AND item_type='income'").run();
  assert.equal(service.chat(request('确认 '+p.confirmation_id)).status,'need_input');
  const expired=service.chat(request('',{command:proposal()}));now=new Date(now.getTime()+16*60000);
  assert.equal(service.chat(request('确认 '+expired.confirmation_id)).status,'need_input');
  const leader=service.chat(request('',{from_user:'wxid-leader',command:proposal()}));db.prepare('UPDATE teams SET leader_user_id=NULL WHERE id=1').run();
  assert.throws(()=>service.chat(request('确认 '+leader.confirmation_id,{from_user:'wxid-leader'})),/无权/);
});

test('bindings require an active administrator and rebinding invalidates old context',()=>{
  service.chat(request('Z团队2026-10工资',{from_user:'wxid-r'}));
  assert.throws(()=>service.bind({account_id:ACCOUNT,from_user:'wxid-r',user_id:4},3),/管理员/);
  assert.throws(()=>bind('wxid-r',4),/原 user_id/);bind('wxid-r',4,true,false,3);
  assert.equal(service.chat(request('工资',{from_user:'wxid-r'})).status,'need_input');
});

test('cached results are not exposed after role, membership or team status changes',()=>{
  const r=request('Z团队2026-10收入',{from_user:'wxid-r'});service.chat(r);
  db.prepare('UPDATE teams SET status=0 WHERE id=1').run();assert.throws(()=>service.chat(r),/权限或绑定/);
});

test('shared ingress scope exports only necessary IDs and response sending rechecks its own conversation',()=>{
  const req=request('Z团队2026-10工资',{from_user:'wxid-r'}),answer=service.chat(req),scope=service.ingressScope();
  assert.ok(scope.private_ids.includes('wxid-r'));assert.doesNotMatch(JSON.stringify(scope),/password|role|2535|收入/);
  const authorized=service.authorizeResponse({...req,text:''});assert.equal(authorized.allowed,true);
  assert.equal(authorized.response_hash,require('crypto').createHash('sha256').update(JSON.stringify(answer)).digest('hex'));
  assert.throws(()=>service.authorizeResponse({...req,text:'',conversation_id:'another'}),/权限或会话/);
});

test('recalculation uses the actual formula service, runs once and polls the original task',()=>{
  const before=canonicalSnapshot(),preview=service.chat(request('',{command:{type:'recalculate',team_id:1,month:'2026-10'}}));
  assert.equal(preview.status,'needs_confirmation');assert.equal(canonicalSnapshot(),before);assert.equal(runCount,0);
  const confirm=request('确认 '+preview.confirmation_id),running=service.chat(confirm);assert.equal(running.status,'running');assert.equal(runCount,0);
  assert.equal(service.taskStatus(running.task_id,request('')).status,'running');assert.equal(count('agent_chat_tasks'),1);
  assert.deepEqual(service.chat(confirm),running);assert.equal(jobs.length,1);
  service.chat(request('确认 '+preview.confirmation_id));assert.equal(count('agent_chat_tasks'),1);
  runJobs();assert.equal(runCount,1);
  const done=service.taskStatus(running.task_id,request(''));assert.equal(done.status,'answered');assert.equal(done.task_id,running.task_id);
  const members=getSettlement(1,'2026-10').result_json.members;
  assert.deepEqual(Object.fromEntries(members.map(m=>[m.name,m.should_get])),{崔如意:2535.37,崔海亮:3063.37,崔紫阳:2535.36,张明亮:3383.53});
  const notifications=service.pullNotifications({account_id:ACCOUNT});assert.equal(notifications.items.length,1);assert.equal(notifications.items[0].recipient_id,OWNER);assert.equal(notifications.items[0].group_id,'');
  assert.match(notifications.items[0].message,/11517\.63/);assert.match(notifications.items[0].message,/支出 软件/);
});
function canonicalSnapshot(){return JSON.stringify(db.prepare('SELECT * FROM settlements ORDER BY id').all());}

test('task access is scoped and service restart does not repeat a running task',()=>{
  const p=service.chat(request('',{command:{type:'recalculate',team_id:1,month:'2026-10'}}));const r=service.chat(request('确认 '+p.confirmation_id));
  assert.throws(()=>service.taskStatus(r.task_id,request('',{from_user:'wxid-leader'})),/不属于/);
  assert.throws(()=>service.taskStatus(r.task_id,request('',{conversation_id:'other'})),/不属于/);
  service.recover();runJobs();assert.equal(runCount,0);assert.equal(service.taskStatus(r.task_id,request('')).status,'failed');
});

test('only the mapped owner can publish, and member notifications contain only own data',()=>{
  const forbidden=service.chat(request('',{from_user:'wxid-leader',command:{type:'publish_settlement',team_id:1,month:'2026-10'}}));assert.equal(forbidden.status,'need_input');
  const p=service.chat(request('',{command:{type:'publish_settlement',team_id:1,month:'2026-10'}}));assert.equal(p.status,'needs_confirmation');
  assert.equal(service.chat(request('确认 '+p.confirmation_id)).status,'needs_confirmation');
  const r=service.chat(request('确认发布 '+p.confirmation_id));runJobs();assert.equal(service.taskStatus(r.task_id,request('')).status,'answered');
  const pending=service.pullNotifications({account_id:ACCOUNT}).items;assert.equal(pending.length,4);assert.ok(pending.every(n=>n.group_id===''&&n.message.startsWith('【性价屋·财务】')&&n.detail_url));
  const own=pending.find(n=>n.recipient_id==='wxid-r');assert.match(own.message,/崔如意/);assert.doesNotMatch(own.message,/张明亮|崔海亮|3383\.53|3063\.37/);
  assert.equal(runCount,0);
});

test('reminder opt-out and permission revocation suppress pending delivery',()=>{
  const n=service.enqueueNotification({source_key:'fixture-notice',from_user:OWNER,team_id:1,month:'2026-10',kind:'anomaly',message:'支出待核对'});assert.ok(n);
  service.chat(request('关闭提醒'));assert.equal(service.pullNotifications({account_id:ACCOUNT}).items.length,0);
  assert.equal(service.enqueueNotification({source_key:'disabled',from_user:OWNER,team_id:1,month:'2026-10',kind:'anomaly',message:'支出待核对'}),null);
  service.chat(request('开启提醒'));service.enqueueNotification({source_key:'revoked',from_user:OWNER,team_id:1,month:'2026-10',kind:'anomaly',message:'支出待核对'});
  db.prepare('UPDATE users SET status=0 WHERE id=1').run();assert.equal(service.pullNotifications({account_id:ACCOUNT}).items.length,0);
});

test('delivery IDs and receipts are idempotent, with no retry for unknown handoff',()=>{
  const id=service.enqueueNotification({source_key:'delivery',from_user:OWNER,team_id:1,month:'2026-10',kind:'anomaly',message:'支出待核对'});
  assert.equal(service.enqueueNotification({source_key:'delivery',from_user:OWNER,team_id:1,month:'2026-10',kind:'anomaly',message:'支出待核对'}),id);
  const item=service.pullNotifications({account_id:ACCOUNT}).items[0];assert.equal(item.delivery_id,`finance:${id}`);
  assert.equal(service.pullNotifications({account_id:ACCOUNT}).items.length,0);
  now=new Date(now.getTime()+3*60000);assert.equal(service.pullNotifications({account_id:ACCOUNT}).items.length,0);
  assert.equal(db.prepare('SELECT state FROM agent_chat_notifications WHERE id=?').get(id).state,'uncertain');
  const receipt={account_id:ACCOUNT,delivery_id:item.delivery_id,state:'accepted'};
  assert.deepEqual(service.notificationReceipt(id,receipt),service.notificationReceipt(id,receipt));
  assert.throws(()=>service.notificationReceipt(id,{...receipt,state:'failed'}),/冲突/);
});

test('the unified sender must recheck permissions immediately before dispatch',()=>{
  const id=service.enqueueNotification({source_key:'authorize',from_user:'wxid-leader',team_id:1,month:'2026-10',kind:'anomaly',message:'支出待核对'});
  service.pullNotifications({account_id:ACCOUNT});
  const envelope={account_id:ACCOUNT,delivery_id:`finance:${id}`};assert.equal(service.authorizeNotification(id,envelope).allowed,true);
  db.prepare('UPDATE teams SET leader_user_id=NULL WHERE id=1').run();
  assert.throws(()=>service.authorizeNotification(id,envelope),/无权/);
});

test('a failed background operation rolls back its writes and is not retried',()=>{
  const failing=createAgentChatService({db,accountId:ACCOUNT,baseUrl:'https://finance.example.invalid',clock:()=>now,schedule:fn=>jobs.push(fn),
    backend:{previewSettlement:settlement.previewSettlement,runSettlement:()=>{db.prepare("UPDATE income_records SET amount=1 WHERE person_name='崔如意'").run();throw new Error('isolated failure');}}});
  const before=JSON.stringify(db.prepare('SELECT * FROM income_records ORDER BY id').all());
  const p=failing.chat(request('',{command:{type:'recalculate',team_id:1,month:'2026-10'}}));const task=failing.chat(request('确认 '+p.confirmation_id));
  runJobs();assert.equal(failing.taskStatus(task.task_id,request('')).status,'failed');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM income_records ORDER BY id').all()),before);assert.equal(count('agent_chat_notifications'),0);assert.equal(jobs.length,0);
});

test('the owner alias alone grants no financial permission, and reminders default off',()=>{
  bind(OWNER,3,true,false,1);
  assert.throws(()=>service.chat(request('',{command:{type:'publish_settlement',team_id:1,month:'2026-10'}})),/无权/);
  bind('wxid-new',6,true,false);
  assert.equal(service.bindings(1).find(b=>b.from_user==='wxid-new').notifications_enabled,0);
  assert.throws(()=>service.bindings(3),/管理员/);
});

test('money and unsupported operations are rejected before any preview or write',()=>{
  for(const fields of [{amount:'-2'},{amount:'1.234'},{amount:528},{payer_name:'非成员'}])assert.throws(()=>service.chat(request('',{command:proposal('create_record',fields)})));
  assert.throws(()=>service.chat(request('',{command:{type:'delete_record',record_id:1}})),/不受支持/);
  assert.equal(count('agent_chat_confirmations'),0);
});

test('HTTP contract authenticates separately and isolates adapter failures',async t=>{
  const app=express();let broken=false;const stub=new Proxy(service,{get(target,key){if(key==='chat'&&broken)return ()=>{throw new Error('PRIVATE_STACK_OR_KEY')};return target[key];}});
  app.use('/api/internal/agent',createInternalAgentRouter({service:stub,settings:()=>({token,accountId:ACCOUNT,jwtSecret:'different-jwt-secret'})}));app.get('/business-health',(req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`,post=(path,body,auth=token)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth}`},body:JSON.stringify(body)});
  const denied=await post('/api/internal/agent/chat',request(),'wrong');assert.equal(denied.status,401);assert.equal((await denied.json()).status,'failed');
  const good=await post('/api/internal/agent/chat',request());assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store');const answer=await good.json();assert.equal(answer.status,'answered');assert.match(answer.message,/11517\.63/);
  const invalid=await post('/api/internal/agent/chat',request('',{agent_id:'business'}));assert.equal(invalid.status,400);
  const unbound=await post('/api/internal/agent/chat',request('',{from_user:'unknown'}));assert.equal((await unbound.json()).status,'failed');
  broken=true;const failure=await post('/api/internal/agent/chat',request());assert.equal(failure.status,503);assert.doesNotMatch(JSON.stringify(await failure.json()),/PRIVATE_STACK/);
  assert.deepEqual(await (await fetch(origin+'/business-health')).json(),{ok:true});
});

test('HTTP tasks and notification handoff preserve their original identifiers',async t=>{
  const app=express();app.use('/api/internal/agent',createInternalAgentRouter({service,settings:()=>({token,accountId:ACCOUNT})}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,body)=>{const r=await fetch(origin+'/api/internal/agent'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  const preview=await post('/chat',request('',{command:{type:'recalculate',team_id:1,month:'2026-10'}}));
  const task=await post('/chat',request('确认 '+preview.confirmation_id));assert.equal(task.status,'running');
  const running=await post(`/tasks/${task.task_id}/query`,request(''));assert.equal(running.task_id,task.task_id);assert.equal(running.status,'running');assert.equal(count('agent_chat_tasks'),1);
  runJobs();assert.equal((await post(`/tasks/${task.task_id}/query`,request(''))).status,'answered');
  const delivery=(await post('/notifications/pull',{account_id:ACCOUNT})).items[0];
  assert.equal((await post(`/notifications/${delivery.notification_id}/authorize`,{account_id:ACCOUNT,delivery_id:delivery.delivery_id})).allowed,true);
  const receipt=await post(`/notifications/${delivery.notification_id}/receipt`,{account_id:ACCOUNT,delivery_id:delivery.delivery_id,state:'accepted'});assert.equal(receipt.state,'accepted');
  assert.equal((await post('/notifications/pull',{account_id:ACCOUNT})).items.length,0);
});

test('missing configuration, shared JWT credentials and bad JSON fail closed',async t=>{
  const app=express();let settings={token:'',accountId:ACCOUNT};
  app.use('/api/internal/agent',createInternalAgentRouter({service,settings:()=>settings}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const url=`http://127.0.0.1:${server.address().port}/api/internal/agent/chat`;
  const send=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body});
  assert.equal((await send(JSON.stringify(request()))).status,503);
  settings={token,accountId:ACCOUNT,jwtSecret:token};assert.equal((await send(JSON.stringify(request()))).status,503);
  settings={token,accountId:ACCOUNT};const malformed=await send('{private-unparseable');assert.equal(malformed.status,400);assert.doesNotMatch(JSON.stringify(await malformed.json()),/private-unparseable/);
  const oversized=await send(JSON.stringify({...request(),text:'x'.repeat(66000)}));assert.equal(oversized.status,413);assert.equal((await oversized.json()).status,'failed');
});

test('the actual app mounts the contract, administrator-only binding API and real detail pages',async t=>{
  process.env.FINANCE_AGENT_SERVICE_TOKEN=token;process.env.FINANCE_AGENT_ACCOUNT_ID=ACCOUNT;
  const app=require('../src/app'),jwt=require('jsonwebtoken'),{env}=require('../src/config/env');
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const adminToken=jwt.sign({id:1,role:'admin'},env.jwtSecret,{expiresIn:'1m'}),memberToken=jwt.sign({id:3,role:'member'},env.jwtSecret,{expiresIn:'1m'});
  const bindings=await fetch(origin+'/api/finance-agent/chat-bindings',{headers:{Authorization:`Bearer ${adminToken}`}});assert.equal(bindings.status,200);assert.equal((await bindings.json()).data.account_id,ACCOUNT);
  const forbidden=await fetch(origin+'/api/finance-agent/chat-bindings',{headers:{Authorization:`Bearer ${memberToken}`}});assert.equal(forbidden.status,403);
  const created=await fetch(origin+'/api/finance-agent/chat-bindings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${adminToken}`},body:JSON.stringify({account_id:ACCOUNT,from_user:'wxid-http-member',user_id:6,enabled:true,notifications_enabled:false})});assert.equal(created.status,200);assert.equal((await created.json()).data.user_id,6);
  const wrongServiceToken=await fetch(origin+'/api/internal/agent/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${adminToken}`},body:JSON.stringify(request())});assert.equal(wrongServiceToken.status,401);
  const reply=await fetch(origin+'/api/internal/agent/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(request('Z团队2026-10收入',{received_at:new Date().toISOString()}))});
  const result=await reply.json();assert.equal(result.status,'answered',result.message);
  for(const path of ['/admin/records','/admin/settlement','/h5/home','/admin/finance-agent']){
    const page=await fetch(origin+path);assert.equal(page.status,200);const html=await page.text();for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(script[1]);
    if(path==='/admin/finance-agent')assert.match(html,/统一微信入口/);
  }
  db.prepare("UPDATE users SET role='member' WHERE id=1").run();
  const revoked=await fetch(origin+'/api/finance-agent/chat-bindings',{headers:{Authorization:`Bearer ${adminToken}`}});assert.equal(revoked.status,403);
});
