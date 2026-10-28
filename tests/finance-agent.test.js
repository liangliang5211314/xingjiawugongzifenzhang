const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createFinanceAgent, GROUP_ID } = require('../src/services/finance-agent-service');

// Literal transcription of the user's image, separate from the extraction implementation.
const receipt = {
  transactions: [
    {date:'2026-10-20',amount:'5083.15',type:'income',description:'宿迁京孚泰大数据信息技术有…'},
    {date:'2026-10-20',amount:'5574.14',type:'income',description:'联盟POP佣金结算'},
    {date:'2026-09-23',amount:'1176.66',type:'income',description:'宿迁京孚泰大数据信息技术有…'},
    {date:'2026-09-23',amount:'638.38',type:'income',description:'联盟POP佣金结算'},
    {date:'2026-06-06',amount:'0.92',type:'refund',description:'退款'},
  ],
  monthly_totals:[{month:'2026-10',amount:'10657.29'},{month:'2026-09',amount:'1815.04'},{month:'2026-06',amount:'0.92'}],
};
const png = suffix => Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('isolated-image-'+suffix)]);
function fixture(t, extraction = receipt) {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname,'../src/database/init.sql'),'utf8'));
  db.exec(`ALTER TABLE users ADD COLUMN jd_account TEXT;
    CREATE TABLE team_rule_members(id INTEGER PRIMARY KEY,team_id INTEGER,member_name TEXT,formula TEXT);
    INSERT INTO teams(id,name,rule_type) VALUES(1,'性价屋Z团队','custom');
    INSERT INTO users(id,name,status,team_id) VALUES(1,'张明亮',1,1),(2,'崔海亮',1,1),(3,'崔如意',1,1),(4,'崔紫阳',1,1);
    INSERT INTO team_rule_members VALUES(1,1,'张明亮','income*0.2'),(2,1,'崔海亮','income*0.8/3'),(3,1,'崔如意','income*0.8/3'),(4,1,'崔紫阳','income*0.8/3');`);
  let calls=0, publications=0;
  const agent=createFinanceAgent({db,recognize:async()=>{calls++;return structuredClone(extraction);},
    clock:()=>new Date('2026-10-28T04:00:00Z'),
    previewSettlement:()=>({total_income:11517.63,total_expense:1608,members:[{name:'张明亮',net_share:2303.53,paid_expense:1080,should_get:3383.53,actual:0}],transfers:[]}),
    publishSettlement:()=>{publications++;},
  });
  agent.configure({team_id:1,account_id:'fixture-bot',owner_id:'wxid-owner',enabled:true});
  agent.bind({sender_id:'wxid-r',user_id:3},1);
  t.after(()=>db.close());
  const submit = suffix => agent.submit({account_id:'fixture-bot',sender_id:'wxid-r',message_id:'message-'+suffix,image:png(suffix)});
  const exchange = (inbox,ready=false) => agent.exchange({proxy_account_id:'fixture-bot',accounts:[{id:'fixture-bot',online:true}],inbox,ready});
  return {db,agent,submit,exchange,get calls(){return calls;},get publications(){return publications;}};
}

test('real receipt shape selects October only and posts once after explicit month confirmation',async t=>{
  const f=fixture(t), row=f.submit('normal');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM income_records').get().n,0);
  const result=await f.agent.process(row.id);
  assert.equal(result.status,'awaiting_confirmation');
  assert.equal(result.source_month,'2026-10');
  assert.match(result.question,/10657\.29/);
  assert.throws(()=>f.agent.confirm(row.id,{}, {admin:1}),/结算月份/);
  f.agent.confirm(row.id,{month:'2026-10'},{admin:1});
  f.agent.confirm(row.id,{month:'2026-10'},{admin:1});
  const records=f.db.prepare('SELECT * FROM income_records').all();
  assert.equal(records.length,1); assert.equal(records[0].amount,1065729); assert.equal(records[0].person_name,'崔如意');
  assert.equal(f.agent.get(row.id).selected.entries.length,2);
  assert.equal(f.publications,0);
});

test('cash receipt month and commission settlement month are independent',async t=>{
  const f=fixture(t), row=f.submit('billing-month');await f.agent.process(row.id);
  f.agent.confirm(row.id,{month:'2026-09',source_month:'2026-10'},{admin:1});
  const record=f.db.prepare('SELECT month,amount FROM income_records').get();
  assert.deepEqual(record,{month:'2026-09',amount:1065729});
});

test('same image is idempotent and other members cannot confirm it',async t=>{
  const f=fixture(t),row=f.submit('repeat');await f.agent.process(row.id);
  const duplicate=f.agent.submit({account_id:'fixture-bot',sender_id:'wxid-r',message_id:'new-message',image:png('repeat')});
  assert.equal(duplicate.id,row.id);assert.equal(f.calls,1);
  assert.throws(()=>f.agent.confirm(row.id,{month:'2026-10'},{account_id:'fixture-bot',sender_id:'wxid-other'}),/本人/);
});

test('unknown sender stays unbound and is not sent to the model before admin binding',async t=>{
  const f=fixture(t),row=f.agent.submit({account_id:'fixture-bot',sender_id:'unknown',message_id:'unknown',image:png('unknown')});
  await f.agent.process(row.id);assert.equal(f.calls,0);assert.equal(f.agent.get(row.id).status,'unbound');
  f.agent.bind({sender_id:'unknown',user_id:2},1);await f.agent.process(row.id);
  assert.equal(f.agent.get(row.id).user_id,2);assert.equal(f.agent.get(row.id).status,'awaiting_confirmation');
});

test('existing monthly income is linked explicitly instead of duplicated',async t=>{
  const f=fixture(t),row=f.submit('existing');await f.agent.process(row.id);
  const id=Number(f.db.prepare("INSERT INTO income_records(team_id,month,person_name,item_type,amount) VALUES(1,'2026-10','崔如意','income',1065729)").run().lastInsertRowid);
  assert.throws(()=>f.agent.confirm(row.id,{month:'2026-10'},{admin:1}),/避免重复入账/);
  f.agent.confirm(row.id,{month:'2026-10',use_existing_id:id},{admin:1});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM income_records').get().n,1);
  assert.deepEqual(f.agent.get(row.id).record_ids,[id]);
});

test('refunds, malformed dates and inconsistent monthly totals cannot post',async t=>{
  const f=fixture(t),row=f.submit('refund');await f.agent.process(row.id);
  assert.throws(()=>f.agent.confirm(row.id,{month:'2026-06',source_month:'2026-06'},{admin:1}),/退款/);
  const bad=structuredClone(receipt);bad.monthly_totals[0].amount='9999.00';
  const g=fixture(t,bad),other=g.submit('bad-total');await g.agent.process(other.id);
  assert.throws(()=>g.agent.confirm(other.id,{month:'2026-10'},{admin:1}),/不一致/);
  const badDate=structuredClone(receipt);badDate.transactions[0].date='2026-02-31';
  const h=fixture(t,badDate),last=h.submit('bad-date');await h.agent.process(last.id);
  assert.equal(h.agent.get(last.id).status,'recognition_failed');
});

test('native replies keep the receipt context and ask for a month rather than guessing',async t=>{
  const f=fixture(t),row=f.submit('native');await f.agent.process(row.id);
  const event={channel:'finance',account_id:'fixture-bot',group_id:GROUP_ID,from_user:'wxid-r',message_id:'confirm-1',message_type:1,is_group:true,create_time:Date.parse('2026-10-28T04:00:00Z')/1000,content:'确认 '+row.id};
  f.exchange(event);assert.equal(f.agent.get(row.id).status,'awaiting_confirmation');
  f.exchange({...event,message_id:'confirm-2',content:'这是10月的'});
  assert.equal(f.agent.get(row.id).month,'2026-10');
  f.exchange({...event,message_id:'confirm-3',content:'确认 '+row.id});
  assert.equal(f.agent.get(row.id).status,'posted');
});

test('monthly statistics go privately to the owner before any group publication',t=>{
  const f=fixture(t);
  assert.throws(()=>f.agent.requestReview('2026-10'),/尚未确认报齐/);
  const review=f.agent.requestReview('2026-10',{admin:1,confirmed_complete:true});
  const first=f.db.prepare('SELECT * FROM finance_outbox').all();
  assert.equal(first.length,1);assert.equal(first[0].group_id,'wxid-owner');assert.equal(f.publications,0);
  const base={channel:'finance',account_id:'fixture-bot',group_id:'',is_group:false,message_type:1,create_time:Date.parse('2026-10-28T04:00:00Z')/1000,content:'确认发布 '+review.id};
  f.exchange({...base,from_user:'wxid-intruder',message_id:'intruder'});assert.equal(f.publications,0);
  f.exchange({...base,from_user:'wxid-owner',message_id:'owner-approved'});assert.equal(f.publications,1);
  f.exchange({...base,from_user:'wxid-owner',message_id:'owner-approved'});assert.equal(f.publications,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM finance_outbox WHERE group_id=? AND id LIKE '%approved-group'").get(GROUP_ID).n,1);
});

test('owner approval is rejected if source records change during review',t=>{
  const f=fixture(t),review=f.agent.requestReview('2026-10',{admin:1,confirmed_complete:true});
  f.db.prepare("INSERT INTO income_records(team_id,month,person_name,item_type,amount) VALUES(1,'2026-10','崔海亮','income',100)").run();
  f.exchange({channel:'finance',account_id:'fixture-bot',group_id:'',is_group:false,from_user:'wxid-owner',message_id:'stale',message_type:1,create_time:Date.parse('2026-10-28T04:00:00Z')/1000,content:'确认发布 '+review.id});
  assert.equal(f.publications,0);assert.equal(f.agent.reviews()[0].status,'stale');
});

test('an administrator can identify the actual expense payer without changing the sender',async t=>{
  const extraction={transactions:[{date:'2026-10-20',amount:'528.00',type:'expense',description:'服务器'}],monthly_totals:[]};
  const f=fixture(t,extraction),row=f.submit('expense-payer');await f.agent.process(row.id);
  f.agent.confirm(row.id,{month:'2026-10',payer_user_id:2},{admin:1});
  const record=f.db.prepare('SELECT person_name,payer_name,amount,item_type FROM income_records').get();
  assert.deepEqual(record,{person_name:'崔如意',payer_name:'崔海亮',amount:52800,item_type:'expense'});
  assert.equal(f.agent.get(row.id).sender_id,'wxid-r');
});

test('expired bridge messages are acknowledged without posting and pending receipts can be cancelled',async t=>{
  const f=fixture(t),row=f.submit('cancel');await f.agent.process(row.id);
  f.agent.cancel(row.id,1);assert.equal(f.agent.get(row.id).status,'cancelled');
  const result=f.exchange({channel:'finance',account_id:'fixture-bot',group_id:GROUP_ID,from_user:'wxid-r',message_id:'old',message_type:1,create_time:1,content:'确认 '+row.id+' 2026-10'});
  assert.equal(result.ack,'fixture-bot:old');
  assert.equal(f.db.prepare('SELECT count(*) n FROM income_records').get().n,0);
});

test('negative or quoted confirmation text never authorizes posting or publishing',async t=>{
  const f=fixture(t),row=f.submit('negative');await f.agent.process(row.id);
  f.exchange({channel:'finance',account_id:'fixture-bot',group_id:GROUP_ID,from_user:'wxid-r',message_id:'no-post',message_type:1,is_group:true,create_time:Date.parse('2026-10-28T04:00:00Z')/1000,content:'不要确认 '+row.id+' 2026-10'});
  assert.equal(f.agent.get(row.id).status,'awaiting_confirmation');
  assert.equal(f.db.prepare('SELECT count(*) n FROM income_records').get().n,0);
  f.agent.cancel(row.id,1);
  const review=f.agent.requestReview('2026-10',{admin:1,confirmed_complete:true});
  f.exchange({channel:'finance',account_id:'fixture-bot',group_id:'',is_group:false,from_user:'wxid-owner',message_id:'no-publish',message_type:1,create_time:Date.parse('2026-10-28T04:00:00Z')/1000,content:'不要确认发布 '+review.id});
  assert.equal(f.publications,0);assert.equal(f.agent.reviews()[0].status,'awaiting_owner');
});
