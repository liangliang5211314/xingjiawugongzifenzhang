const assert=require('node:assert/strict');
const {test,beforeEach,after}=require('node:test');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
process.env.DB_PATH=':memory:';const {db}=require('../src/config/database');assert.equal(db.name,':memory:');
db.exec(fs.readFileSync(path.join(__dirname,'../src/database/init.sql'),'utf8'));
db.exec('ALTER TABLE users ADD COLUMN jd_account TEXT;ALTER TABLE teams ADD COLUMN leader_user_id INTEGER;ALTER TABLE teams ADD COLUMN report_member_names TEXT;ALTER TABLE settlements ADD COLUMN year_compare_prev3 INTEGER;');
const settlement=require('../src/services/settlement-service'),records=require('../src/services/record-service');
const {getSettlement}=require('../src/models/settlement-model'),{setRuleMembers}=require('../src/models/team-rule-member-model');
const {createAgentChatService}=require('../src/services/agent-chat-service'),{createFinanceCollection,monthFrom}=require('../src/services/finance-collection-service');
const BOT='fixture-bot',OWNER='ZML741213442',GROUP='19116819870@chatroom';
const receipt={transactions:[{date:'2026-10-20',amount:'5083.15',type:'income',description:'京东收益一'},{date:'2026-10-20',amount:'5574.14',type:'income',description:'京东收益二'},
  {date:'2026-09-23',amount:'1176.66',type:'income',description:'九月收益一'},{date:'2026-09-23',amount:'638.38',type:'income',description:'九月收益二'},{date:'2026-06-06',amount:'0.92',type:'refund',description:'退款'}],
  monthly_totals:[{month:'2026-10',amount:'10657.29'},{month:'2026-09',amount:'1815.04'}]};
let service,collection,jobs,serial,calls,runs,now,extractions;
beforeEach(()=>{
  for(const table of ['agent_collection_images','agent_collection_members','agent_collection_sessions','agent_chat_notifications','agent_chat_tasks','agent_chat_confirmations','agent_chat_requests','agent_chat_contexts','agent_chat_group_push','agent_chat_bindings','income_records','settlements','team_rule_members','user_teams','users','teams'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))db.exec('DELETE FROM '+table);
  db.exec(`INSERT INTO teams(id,name,rule_type,rule_config,leader_user_id,report_member_names) VALUES(1,'性价屋Z团队','custom','{}',2,'["张明亮","崔海亮","崔如意","崔紫阳"]'),(2,'L团队','standard','{}',NULL,'[]');
    INSERT INTO users(id,name,role,status,team_id) VALUES(1,'张明亮','admin',1,1),(2,'崔海亮','member',1,1),(3,'崔如意','member',1,1),(4,'崔紫阳','member',1,1),(5,'其他人','member',1,2);
    INSERT INTO user_teams SELECT id,team_id FROM users;
    INSERT INTO income_records(team_id,month,person_name,item_type,item_name,amount,payer_name) VALUES
    (1,'2026-10','崔如意','income','income',1065729,NULL),(1,'2026-10','崔海亮','income','income',42,NULL),(1,'2026-10','崔紫阳','income','income',85992,NULL),
    (1,'2026-10','张明亮','expense','软件',108000,'张明亮'),(1,'2026-10','崔海亮','expense','服务器',-52800,'崔海亮');`);
  setRuleMembers(1,[{member_name:'张明亮',rule_mode:'formula',formula:'round(income*0.2)+paid_expense'},...['崔海亮','崔如意','崔紫阳'].map(member_name=>({member_name,rule_mode:'formula',formula:'(income-round(income*0.2)-expense)/3+paid_expense'}))]);
  settlement.runSettlement(1,'2026-10');jobs=[];serial=0;calls=0;runs=0;now=new Date('2026-10-29T06:00:00Z');extractions=new Map();collection=undefined;
  const backend={addRecord:records.addRecord,previewSettlement:settlement.previewSettlement,fetchSettlement:getSettlement,runSettlement:(...a)=>{runs++;return settlement.runSettlement(...a);}};
  service=createAgentChatService({db,accountId:BOT,ownerId:OWNER,baseUrl:'https://finance.example.invalid',getCollection:()=>collection,clock:()=>now,schedule:fn=>jobs.push(fn),backend});
  for(const [from_user,user_id]of [[OWNER,1],['wxid-h',2],['wxid-r',3],['wxid-z',4],['wxid-other',5]])service.bind({account_id:BOT,from_user,user_id,enabled:true,notifications_enabled:from_user===OWNER},1);
  service.configureGroupPush({enabled:true},1);
  collection=createFinanceCollection({db,accountId:BOT,ownerId:OWNER,clock:()=>now,schedule:fn=>jobs.push(fn),backend,recognize:async buffer=>{calls++;const value=extractions.get(buffer.toString('base64'))||receipt;if(value instanceof Error)throw value;return structuredClone(value);},
    access:service.collectionAccess,policy:service.collectionPolicy,members:service.collectionMembers,review:service.requestCollectionReview,
    notice:(s,m,message,key)=>service.enqueueNotification({source_key:`collection:${s.id}:${m.user_id}:${crypto.createHash('sha256').update(key).digest('hex').slice(0,16)}`,from_user:OWNER,team_id:s.team_id,month:s.month,kind:'collection_notice',message:'@'+m.name+' '+message})});
});
after(()=>db.close());
function req(sender,text,group=GROUP){return {request_id:'collection-fixture-'+(++serial),agent_id:'finance',account_id:BOT,from_user:sender,group_id:group,conversation_id:'wechat:'+crypto.createHash('sha256').update(JSON.stringify([BOT,group,sender])).digest('hex').slice(0,40),text,received_at:now.toISOString()};}
const say=(sender,text)=>service.chat(req(sender,text)),snapshot=()=>JSON.stringify({records:db.prepare('SELECT * FROM income_records ORDER BY id').all(),settlements:db.prepare('SELECT * FROM settlements ORDER BY id').all()});
async function flush(){while(jobs.length)await jobs.shift()();}
function image(sender,suffix='normal',extraction=receipt){const buffer=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('fixture-image-'+suffix)]);extractions.set(buffer.toString('base64'),extraction);
  return service.collectionImage({...req(sender,''),collection_id:collection.scope()?.id||'0000000000000000',image_base64:buffer.toString('base64'),mime_type:'image/png'});}
function start(){return say(OWNER,'@助理2 结算十月工资');}
function finishManual(){say(OWNER,'本月无收入');say('wxid-h','本月无收入');say('wxid-z','本月总收入是1000元');say('wxid-z','报齐');return say('wxid-r','报齐');}

test('the real owner starts a scoped collection and mentions exactly the configured bound members',()=>{
  const before=snapshot(),request=req(OWNER,'@助理2 结算工资'),ask=service.chat(request);assert.equal(ask.status,'need_input');assert.match(ask.message,/哪个月/);assert.equal(collection.scope(),null);
  const response=say(OWNER,'@助理2 十月');assert.equal(response.status,'answered');assert.deepEqual(new Set(response.at_wxids),new Set([OWNER,'wxid-h','wxid-r','wxid-z']));assert.match(response.message,/发齐后回复“报齐”/);
  assert.equal(collection.scope().expected_senders.length,4);assert.equal(snapshot(),before);assert.equal(calls,0);
  assert.equal(say(OWNER,'@助理2 再结算十月工资').collection_id,response.collection_id);assert.equal(db.prepare('SELECT count(*) n FROM agent_collection_sessions').get().n,1);
});
test('missing or ambiguous member identity never turns a nickname into an authorized financial account',()=>{
  db.prepare("UPDATE agent_chat_bindings SET enabled=0 WHERE from_user='wxid-h'").run();const response=start();assert.equal(response.status,'need_input');assert.match(response.message,/崔海亮.*身份/);assert.equal(collection.scope(),null);
  assert.throws(()=>image('wxid-h'),/当前没有/);assert.equal(calls,0);
});
test('screenshots are asynchronously recognized once and tied to the real sender without writing the ledger',async()=>{
  start();const before=snapshot(),job=image('wxid-r');assert.equal(job.status,'running');const same=image('wxid-r');assert.equal(same.task_id,job.task_id);await flush();assert.equal(calls,1);assert.equal(snapshot(),before);
  const row=db.prepare('SELECT * FROM agent_collection_images WHERE id=?').get(job.task_id);assert.equal(row.source_month,'2026-10');assert.equal(row.status,'recognized');
  const notices=service.pullNotifications({account_id:BOT}).items;assert.ok(notices.some(n=>n.message.includes('截图已识别')&&n.at_wxids.includes('wxid-r')));assert.ok(notices.every(n=>!n.message.includes('10657.29')));
  assert.throws(()=>image('wxid-other'),/无权/);assert.equal(calls,1);
  assert.equal(service.taskStatus(job.task_id,req('wxid-r','')).status,'answered');assert.throws(()=>service.taskStatus(job.task_id,req('wxid-h','')),/本人/);
});
test('all members report complete before a preview goes privately to the owner; only explicit owner approval commits and publishes',async()=>{
  start();const before=snapshot(),originalRows=db.prepare('SELECT * FROM income_records ORDER BY id').all();image('wxid-r');await flush();const completed=finishManual();assert.match(completed.message,/全部报齐/);assert.equal(collection.status().status,'awaiting_owner');assert.equal(snapshot(),before);assert.equal(runs,0);
  const c=db.prepare("SELECT * FROM agent_chat_confirmations WHERE status='pending'").get();assert.equal(JSON.parse(c.action_json).type,'collection_finalize');
  const notices=service.pullNotifications({account_id:BOT}).items;const reviews=notices.filter(n=>n.confirmation_id===c.id);assert.ok(reviews.length);assert.ok(reviews.every(n=>n.recipient_id===OWNER&&n.group_id===''));assert.ok(reviews.map(n=>n.message).join('').includes('按差额补记收入'));
  assert.equal(service.chat(req(OWNER,'确认 '+c.id,'')).status,'needs_confirmation');assert.equal(snapshot(),before);
  const approved=service.chat(req(OWNER,'确认发布 '+c.id,''));assert.equal(approved.status,'running');await flush();assert.equal(runs,1);assert.equal(collection.status(),null);
  const saved=getSettlement(1,'2026-10');assert.equal(saved.total_income,1165729);assert.equal(saved.total_expense,160800);assert.deepEqual(originalRows.map(r=>db.prepare('SELECT * FROM income_records WHERE id=?').get(r.id)),originalRows);
  assert.equal(db.prepare("SELECT SUM(amount) n FROM income_records WHERE person_name='崔海亮' AND item_type='income'").get().n,0);
  const groups=service.pullNotifications({account_id:BOT}).items.filter(n=>n.group_id===GROUP&&n.message.includes('月度结算报告'));assert.ok(groups.length);assert.ok(groups.every(n=>service.authorizeNotification(n.notification_id,{account_id:BOT,delivery_id:n.delivery_id}).allowed));
  for(const n of reviews)assert.equal(service.notificationReceipt(n.notification_id,{account_id:BOT,delivery_id:n.delivery_id,state:'accepted'}).state,'accepted');
});
test('a stale ledger or a different user cannot approve a collection preview',async()=>{
  start();image('wxid-r');await flush();finishManual();const c=db.prepare("SELECT * FROM agent_chat_confirmations WHERE status='pending'").get();
  assert.equal(service.chat(req('wxid-h','确认发布 '+c.id,'')).status,'need_input');
  db.prepare("UPDATE income_records SET note='changed after review' WHERE item_type='expense'").run();const before=snapshot();assert.equal(service.chat(req(OWNER,'确认发布 '+c.id,'')).status,'need_input');await flush();assert.equal(snapshot(),before);assert.equal(runs,0);
});
test('different receipt months prompt the exact member, and ordinary chat does not complete the task',async()=>{
  start();const september={transactions:[{date:'2026-09-01',amount:'10.00',type:'income',description:'九月到账'}],monthly_totals:[{month:'2026-09',amount:'10.00'}]};image('wxid-r','september',september);await flush();
  assert.equal(db.prepare('SELECT status FROM agent_collection_images').get().status,'needs_input');assert.equal(say('wxid-r','报齐').status,'need_input');
  say('wxid-r','@助理2 用九月数据');assert.equal(db.prepare('SELECT source_month FROM agent_collection_images').get().source_month,'2026-09');say('wxid-r','我发齐了');finishManual();assert.equal(JSON.parse(db.prepare('SELECT preview_json FROM agent_collection_sessions').get().preview_json).total_income,101000);
});
test('multiple complete platforms sum correctly while overlapping screenshots are not counted twice',async()=>{
  start();image('wxid-r','JD');image('wxid-r','JD-crop');image('wxid-r','TB',{transactions:[{date:'2026-10-22',amount:'1000.00',type:'income',description:'淘宝收益'}],monthly_totals:[{month:'2026-10',amount:'1000.00'}]});await flush();
  say('wxid-r','报齐');finishManual();assert.equal(JSON.parse(db.prepare('SELECT preview_json FROM agent_collection_sessions').get().preview_json).total_income,1265729);assert.equal(calls,3);
});
test('incomplete, unreadable or refund images are held for clarification and manual totals remain explicit',async()=>{
  start();image('wxid-r','partial',{transactions:[{date:'2026-10-20',amount:'20.00',type:'income',description:'明细'}],monthly_totals:[{month:'2026-10',amount:'100.00'}]});await flush();assert.equal(say('wxid-r','报齐').status,'need_input');
  say('wxid-r','我本月总收入是100元');assert.match(say('wxid-r','报齐').message,/已报齐/);
  image('wxid-h','failed',new Error('PRIVATE_MODEL_KEY_OR_TRACE'));await flush();assert.equal(say('wxid-h','报齐').status,'need_input');
  const texts=db.prepare('SELECT message FROM agent_chat_notifications').all().map(n=>n.message).join('');assert.doesNotMatch(texts,/PRIVATE_MODEL|页面上传/);
});
test('closing a collection or changing a binding revokes its image window and queued replies',async()=>{
  start();image('wxid-r');await flush();const n=service.pullNotifications({account_id:BOT}).items.find(n=>n.at_wxids?.includes('wxid-r'));assert.ok(n);
  say(OWNER,'@助理2 取消本次收集');assert.equal(collection.scope(),null);assert.throws(()=>service.authorizeNotification(n.notification_id,{account_id:BOT,delivery_id:n.delivery_id}),/收集已结束/);
  start();db.prepare("UPDATE agent_chat_bindings SET revision=revision+1 WHERE from_user='wxid-r'").run();assert.equal(collection.scope(),null);assert.throws(()=>image('wxid-r'));
});
test('the collection month accepts ordinary Chinese and never defaults an unspecified write period',()=>{
  assert.equal(monthFrom('十月工资',now),'2026-10');assert.equal(monthFrom('上个月',now),'2026-09');assert.equal(monthFrom('2025年8月',now),'2025-08');assert.equal(monthFrom('开始结算工资',now),null);
});

test('identical screenshots from different people are held for that member rather than assigned twice',async()=>{
  start();image('wxid-r');await flush();const second=image('wxid-h');assert.equal(second.status,'need_input');assert.equal(calls,1);
  assert.equal(db.prepare('SELECT count(*) n FROM agent_collection_images').get().n,1);assert.equal(say('wxid-h','报齐').status,'need_input');
  assert.ok(service.pullNotifications({account_id:BOT}).items.some(n=>n.at_wxids?.includes('wxid-h')&&n.message.includes('另一位成员')));
});

test('the owner can refresh an expired preview without reusing the old confirmation',async()=>{
  start();image('wxid-r');await flush();finishManual();const old=db.prepare("SELECT id FROM agent_chat_confirmations WHERE status='pending'").get().id;
  now=new Date(now.getTime()+16*60*1000);const before=snapshot();assert.match(say(OWNER,'@助理2 重新核对').message,/重新生成/);assert.equal(snapshot(),before);
  assert.equal(db.prepare('SELECT status FROM agent_chat_confirmations WHERE id=?').get(old).status,'cancelled');assert.equal(db.prepare("SELECT count(*) n FROM agent_chat_confirmations WHERE status='pending'").get().n,1);
});

test('the authenticated collection image HTTP route accepts real screenshot-sized bodies and preserves the async task ID',async t=>{
  start();const express=require('express'),{createInternalAgentRouter}=require('../src/routes/internal-agent'),token='fixture-independent-service-credential-long-enough',app=express();
  app.use('/api/internal/agent',createInternalAgentRouter({service,settings:()=>({token,accountId:BOT})}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const buffer=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(100000,7)]),body={...req('wxid-r',''),collection_id:collection.scope().id,image_base64:buffer.toString('base64'),mime_type:'image/png'};
  extractions.set(body.image_base64,receipt);const post=auth=>fetch(`http://127.0.0.1:${server.address().port}/api/internal/agent/collection/image`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)});
  assert.equal((await post('wrong')).status,401);assert.equal(calls,0);const result=await post(token);assert.equal(result.status,200);const answer=await result.json();assert.equal(answer.status,'running');await flush();assert.equal(calls,1);
  assert.equal((await(await post(token)).json()).task_id,answer.task_id);assert.equal(calls,1);
});
