const {randomBytes,createHash}=require('crypto');
const {HttpError}=require('../utils/http-error');
const {imageType,normalizeReceipt,cents}=require('./finance-agent-service');
const GROUP='19116819870@chatroom',MONTH=/^20\d{2}-(0[1-9]|1[0-2])$/,id=()=>randomBytes(8).toString('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex'),money=n=>(n/100).toFixed(2);
function monthFrom(text,now){
  const full=text.match(/(20\d{2})[-年](\d{1,2})月?/);if(full){const m=`${full[1]}-${full[2].padStart(2,'0')}`;return MONTH.test(m)?m:null;}
  const date=new Date(now.getTime()+8*3600000);if(/上个?月/.test(text)){date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);}
  if(/本月|这个月/.test(text))return date.toISOString().slice(0,7);
  const part=text.match(/([一二三四五六七八九十]{1,3}|\d{1,2})月份?/);if(!part)return null;
  const cn=['','一','二','三','四','五','六','七','八','九','十','十一','十二'],m=/^\d+$/.test(part[1])?Number(part[1]):cn.indexOf(part[1]);
  const year=date.getUTCFullYear()-(/前年/.test(text)?2:/去年/.test(text)?1:0);return m>0&&m<13?`${year}-${String(m).padStart(2,'0')}`:null;
}
function createFinanceCollection({db,accountId,ownerId,clock=()=>new Date(),schedule=fn=>setImmediate(fn),recognize,backend,access,policy,members,notice,review,onError=()=>{}}){
  db.exec(`CREATE TABLE IF NOT EXISTS agent_collection_sessions(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,team_id INTEGER NOT NULL,month TEXT,status TEXT NOT NULL,
    creator_id INTEGER NOT NULL,members_json TEXT NOT NULL,group_revision INTEGER NOT NULL,preview_json TEXT,review_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_collection_members(session_id TEXT NOT NULL,user_id INTEGER NOT NULL,sender_id TEXT NOT NULL,name TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,
      manual_total INTEGER,question_json TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(session_id,user_id));
    CREATE TABLE IF NOT EXISTS agent_collection_images(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,user_id INTEGER NOT NULL,event_key TEXT NOT NULL UNIQUE,image_hash TEXT NOT NULL,
      image_data BLOB NOT NULL,mime_type TEXT NOT NULL,status TEXT NOT NULL,extraction_json TEXT,source_month TEXT,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(session_id,user_id,image_hash));`);
  const stamp=()=>clock().toISOString(),get=sid=>db.prepare('SELECT * FROM agent_collection_sessions WHERE id=?').get(sid);
  const rows=sid=>db.prepare('SELECT * FROM agent_collection_members WHERE session_id=? ORDER BY user_id').all(sid);
  const active=()=>db.prepare("SELECT * FROM agent_collection_sessions WHERE account_id=? AND status IN ('awaiting_month','collecting','awaiting_owner') AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(accountId,stamp());
  function check(session){
    const p=policy();if(!session||!p||p.team_id!==session.team_id||p.revision!==session.group_revision||session.expires_at<=stamp())throw new HttpError(409,'本次收集已结束或设置发生变化，请主人重新发起');
    const owner=access({account_id:accountId,from_user:ownerId},true);if(owner.id!==session.creator_id)throw new HttpError(403,'主人身份发生变化，请重新发起');
    if(session.status!=='awaiting_month'&&hash(members())!==hash(JSON.parse(session.members_json)))throw new HttpError(409,'成员绑定或上报名单有变化，请主人重新发起收集');return owner;
  }
  function annotate(result,session,at=[]){return {...result,collection_id:session.id,at_wxids:at};}
  function progress(session){const list=rows(session.id),done=list.filter(m=>m.done).map(m=>m.name),missing=list.filter(m=>!m.done).map(m=>m.name);return `已报齐：${done.join('、')||'暂无'}；还差：${missing.join('、')||'已全部报齐'}。`;}
  function start(request,text){
    if(request.from_user!==ownerId)throw new HttpError(403,'请主人在群里 @助理2 发起工资收集');const actor=access(request,true),p=policy();if(!p)throw new HttpError(409,'请先开启 Z团队的助理2群推送');
    let session=active();if(session){check(session);if(/取消.*收集|取消.*工资/.test(text)){db.prepare("UPDATE agent_collection_sessions SET status='cancelled',updated_at=? WHERE id=?").run(stamp(),session.id);return {status:'answered',message:'已取消本次收集，没有修改收入或结算。'};}
      if(session.status==='awaiting_month'){const month=monthFrom(text,clock())||session.month;if(!month)return annotate({status:'need_input',message:'你要结算哪个月？说“十月”或“上个月”就可以。'},session);db.prepare('UPDATE agent_collection_sessions SET month=? WHERE id=?').run(month,session.id);session=get(session.id);}
      else {if(session.status==='awaiting_owner'&&/重新核对|重发预览/.test(text)){complete(session);return annotate({status:'answered',message:'已按当前收支重新生成预览，先私发给你核对。之前的确认单已作废。'},session);}return annotate({status:'answered',message:`当前在收集 ${session.month} 工资。${progress(session)}${session.status==='awaiting_owner'?'已私发你核对，确认后才会发群；需要更新可 @我说“重新核对”。':''}`},session);}
    }else{const month=monthFrom(text,clock()),sid=id();db.prepare('INSERT INTO agent_collection_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(sid,accountId,p.team_id,month,'awaiting_month',actor.id,'[]',p.revision,null,null,stamp(),stamp(),new Date(clock().getTime()+24*3600000).toISOString());session=get(sid);}
    if(!session.month)return annotate({status:'need_input',message:'你要结算哪个月？说“十月”或“上个月”就可以。'},session);
    const list=members();if(!list.length)throw new HttpError(409,'请先确认本月需要上报的成员');
    db.prepare("UPDATE agent_collection_sessions SET members_json=?,status='collecting',updated_at=? WHERE id=?").run(JSON.stringify(list),stamp(),session.id);
    for(const m of list)db.prepare('INSERT OR IGNORE INTO agent_collection_members(session_id,user_id,sender_id,name) VALUES(?,?,?,?)').run(session.id,m.user_id,m.sender_id,m.name);
    return annotate({status:'answered',message:`${list.map(m=>'@'+m.name).join(' ')}\n开始收集 ${session.month} 工资。请发送本月完整收入截图，多张可以连续发；发齐后回复“报齐”。本月没有收入可回复“本月无收入”。\n只在本次收集期间接收你们的截图；看不清或月份不一致时，我会再问。收齐后先私发主人核对，确认后再发群。`,},get(session.id),list.map(m=>m.sender_id));
  }
  function totals(session,m){
    if(m.manual_total!==null)return {amount:m.manual_total,manual:true};
    const images=db.prepare("SELECT * FROM agent_collection_images WHERE session_id=? AND user_id=? AND status='recognized' ORDER BY created_at,id").all(session.id,m.user_id);
    if(!images.length)throw new HttpError(409,'还没收到你的有效收入截图；本月没有收入可回复“本月无收入”');
    const union=new Map(),partialTotals=new Set();let overlap=false;
    for(const image of images){const extraction=JSON.parse(image.extraction_json),entries=extraction.transactions.filter(e=>e.date.startsWith(image.source_month));
      if(!entries.length||entries.some(e=>e.type!=='income'))throw new HttpError(409,'截图中含支出或退款，请补发本月纯收入截图，或说明本月收入总额');
      const local=new Map();for(const e of entries){const key=canonical([e.transaction_id||'',e.date,e.time||'',e.amount,e.description.replace(/\s/g,'')]);local.set(key,{amount:cents(e.amount),count:(local.get(key)?.count||0)+1});}
      for(const [key,v]of local){if(union.has(key))overlap=true;const old=union.get(key);if(!old||v.count>old.count)union.set(key,v);}
      const visible=entries.reduce((sum,e)=>sum+cents(e.amount),0);for(const t of extraction.monthly_totals.filter(t=>t.month===image.source_month))if(cents(t.amount)!==visible)partialTotals.add(cents(t.amount));
    }
    const amount=[...union.values()].reduce((n,v)=>n+v.amount*v.count,0);
    if(partialTotals.size>1||partialTotals.size===1&&![...partialTotals].includes(amount))throw new HttpError(409,'截图明细和月度合计还没对上，可能没有截全，请补图；也可以说明“本月总收入是…元”再报齐');
    return {amount,overlap};
  }
  function inputHash(session){return hash({members:rows(session.id),images:db.prepare('SELECT id,image_hash,status,extraction_json,source_month FROM agent_collection_images WHERE session_id=? ORDER BY id').all(session.id)});}
  function applyTotals(session){const changes=[];for(const m of rows(session.id)){const amount=totals(session,m).amount,old=db.prepare("SELECT COALESCE(SUM(amount),0) amount FROM income_records WHERE team_id=? AND month=? AND person_name=? AND item_type='income'").get(session.team_id,session.month,m.name).amount;
      const delta=amount-old;changes.push({name:m.name,previous:old,total:amount,delta,manual:m.manual_total!==null});if(delta)backend.addRecord({team_id:session.team_id,month:session.month,person_name:m.name,item_type:'income',item_name:'工资截图核对差额',amount:money(delta),note:`工资收集 ${session.id}；原收入 ${money(old)}；核对后 ${money(amount)}；保留原记录`,created_by:session.creator_id});}
    if(changes.length&&!db.prepare('SELECT 1 FROM income_records WHERE team_id=? AND month=? LIMIT 1').get(session.team_id,session.month))backend.addRecord({team_id:session.team_id,month:session.month,person_name:changes[0].name,item_type:'income',item_name:'本月无收入申报',amount:'0.00',note:`工资收集 ${session.id}；成员均已确认无收入`,created_by:session.creator_id});return changes;}
  function preview(session){db.exec('SAVEPOINT collection_preview');try{const changes=applyTotals(session),saved=backend.previewSettlement(session.team_id,session.month);return {saved,changes};}finally{db.exec('ROLLBACK TO collection_preview');db.exec('RELEASE collection_preview');}}
  function complete(session){
    if(rows(session.id).some(m=>!m.done))return null;check(session);const value=preview(session),draftHash=inputHash(session);
    return db.transaction(()=>{const reviewId=review(session,value.saved,value.changes,draftHash);
      db.prepare("UPDATE agent_collection_sessions SET status='awaiting_owner',preview_json=?,review_id=?,updated_at=? WHERE id=?").run(JSON.stringify(value.saved),reviewId,stamp(),session.id);return reviewId;})();
  }
  function handleText(request){
    if(request.group_id!==GROUP)return null;const text=request.text.replace(/@[^\s]+\s*/gu,'').trim(),session=active();
    if((/结算|收集|统计|算工资|报工资/.test(text)&&/工资|收入|截图|收集/.test(text))||/取消.*收集/.test(text)||session?.status==='awaiting_owner'&&/重新核对|重发预览/.test(text)||session?.status==='awaiting_month'&&request.from_user===ownerId)return start(request,text);
    if(!session||session.status!=='collecting')return null;check(session);const m=rows(session.id).find(m=>m.sender_id===request.from_user);if(!m)return null;access(request,false);
    if(/^(?:还差谁|收齐了吗|收了多少|收集进度)[？?。!！\s]*$/.test(text))return annotate({status:'answered',message:progress(session)},session);
    const q=JSON.parse(m.question_json),manual=text.match(/^(?:我)?(?:本月|这个月)?(?:的)?(?:总)?收入(?:是|为|共|一共)?\s*[¥￥]?\s*(\d{1,8}(?:\.\d{1,2})?)\s*元?[。!！\s]*$/),zero=/^(?:我)?(?:(?:本月|这个月)(?:没有|无|没|零|0)(?:收入)?|(?:没有|无|没)收入|0元)[。!！\s]*$/.test(text);
    if(manual||zero){const total=zero?0:Math.round(Number(manual[1])*100);db.prepare("UPDATE agent_collection_members SET manual_total=?,done=?,question_json='{}' WHERE session_id=? AND user_id=?").run(total,zero?1:0,session.id,m.user_id);
      const reviewId=zero&&complete(session);return annotate({status:'answered',message:`${m.name}，已按你说明的本月收入暂存核对。${zero?(reviewId?'已全部报齐，先发给主人核对。':progress(session)):'发齐后回复“报齐”，再交给主人确认。'}`},session);}
    if(q.type==='source_month'){const yes=/^(?:是的?|对的?|确认|好的?|没问题)[。!！\s]*$/.test(text),chosen=monthFrom(text,clock())||(yes&&q.months.length===1?q.months[0]:null);
      if(chosen&&q.months.includes(chosen)){db.prepare("UPDATE agent_collection_images SET source_month=?,status='recognized',updated_at=? WHERE id=?").run(chosen,stamp(),q.image_id);
        const next=db.prepare("SELECT id,extraction_json FROM agent_collection_images WHERE session_id=? AND user_id=? AND status='needs_input' ORDER BY created_at,id LIMIT 1").get(session.id,m.user_id);
        const nextQuestion=next?{type:'source_month',image_id:next.id,months:[...new Set(JSON.parse(next.extraction_json).transactions.map(t=>t.date.slice(0,7)))]}:{};
        db.prepare('UPDATE agent_collection_members SET question_json=? WHERE session_id=? AND user_id=?').run(JSON.stringify(nextQuestion),session.id,m.user_id);
        return annotate({status:'answered',message:`${m.name}，已选用截图 ${chosen} 的收入，计入本次 ${session.month} 工资。${next?'还有一张截图需要确认月份：'+nextQuestion.months.join('、'):'请核对总额，发齐后回复“报齐”。'}`},session);
      }
      if(yes)return annotate({status:'need_input',message:`${m.name}，这张有多个月份，请说明取哪一个：${q.months.join('、')}。`},session);
    }
    if(/^(?:我)?(?:已经|已)?(?:都)?(?:报齐|发齐|发完|传完|齐了)(?:了)?[。!！\s]*$/.test(text)){
      if(db.prepare("SELECT 1 FROM agent_collection_images WHERE session_id=? AND user_id=? AND status='processing'").get(session.id,m.user_id))return annotate({status:'need_input',message:`${m.name}，有图片还在识别，识别完我会告诉你。`},session);
      if(q.type==='source_month')return annotate({status:'need_input',message:`${m.name}，请先确认取截图中哪个月的数据：${q.months.join('、')}。`},session);
      if(m.manual_total===null&&db.prepare("SELECT 1 FROM agent_collection_images WHERE session_id=? AND user_id=? AND status IN ('failed','needs_input') LIMIT 1").get(session.id,m.user_id))return annotate({status:'need_input',message:`${m.name}，还有截图需要补充说明。请确认截图月份，或直接说明“本月总收入是…元”后再报齐。`},session);
      let value;try{value=totals(session,m);}catch(e){return annotate({status:'need_input',message:`${m.name}，${e.message}`},session);}
      db.prepare('UPDATE agent_collection_members SET done=1 WHERE session_id=? AND user_id=?').run(session.id,m.user_id);const reviewId=complete(session);
      return annotate({status:'answered',message:`${m.name}，${session.month} 收入截图已报齐${value.overlap?'（重叠明细已去重，请留意核对）':''}。${reviewId?'成员已全部报齐，结算预览先私发给主人；确认前不改账、不发群。':progress(session)}`},session);
    }
    return null;
  }
  const processing=new Set();
  async function processImage(imageId){if(processing.has(imageId))return;processing.add(imageId);const image=db.prepare('SELECT * FROM agent_collection_images WHERE id=?').get(imageId);if(!image||image.status!=='processing'){processing.delete(imageId);return;}
    try{const session=get(image.session_id);check(session);if(session.status!=='collecting')return;const m=rows(session.id).find(m=>m.user_id===image.user_id);access({account_id:accountId,from_user:m.sender_id},false);
      const extraction=normalizeReceipt(await recognize(image.image_data,image.mime_type));check(get(session.id));if(get(session.id).status!=='collecting')return;
      const months=[...new Set(extraction.transactions.map(t=>t.date.slice(0,7)))].sort(),source=months.includes(session.month)?session.month:null;
      db.prepare('UPDATE agent_collection_images SET extraction_json=?,source_month=?,status=?,updated_at=? WHERE id=?').run(JSON.stringify(extraction),source,source?'recognized':'needs_input',stamp(),imageId);
      if(!source){db.prepare('UPDATE agent_collection_members SET question_json=? WHERE session_id=? AND user_id=?').run(JSON.stringify({type:'source_month',image_id:imageId,months}),session.id,m.user_id);
        notice(session,m,`这张截图显示 ${months.join('、')} 到账，本次收集 ${session.month} 工资。请说明用截图哪个月的数据，例如“用${Number(months[0].slice(5))}月数据”。`,imageId);}
      else{db.prepare("UPDATE agent_collection_images SET status='superseded' WHERE session_id=? AND user_id=? AND status='failed'").run(session.id,m.user_id);let value;try{value=totals(session,rows(session.id).find(x=>x.user_id===m.user_id));}catch(e){notice(session,m,e.message,imageId);return;}
        notice(session,m,`截图已识别，已暂存用于 ${session.month} 工资核对。${value.overlap?'截图有重叠明细，已先去重；如是不同的收入，请说明本月总额。':''}多张截图可继续发，全部发齐后回复“报齐”；金额明细先给主人确认。`,imageId);}
    }catch(error){db.prepare("UPDATE agent_collection_images SET status='failed',error=?,updated_at=? WHERE id=? AND status='processing'").run(error instanceof HttpError?error.message:'识别暂未完成',stamp(),imageId);
      try{const session=get(image.session_id),m=rows(session.id).find(m=>m.user_id===image.user_id);if(session.status==='collecting')notice(session,m,'这张图片还没看清，请发清晰原图；也可以说明“本月总收入是…元”，我会把人工补充情况一并交给主人核对。',imageId);}catch{}
      onError(error);
    }finally{processing.delete(imageId);}}
  function submitImage(request,buffer){const session=active();if(!session||session.status!=='collecting'||request.collection_id!==session.id)throw new HttpError(409,'当前没有你的工资收集任务，请主人先 @助理2 发起');
    check(session);const actor=access(request,false),m=rows(session.id).find(m=>m.user_id===actor.id&&m.sender_id===request.from_user);if(!m)throw new HttpError(403,'这次没有向该微信身份收集截图');
    const mime=imageType(buffer),imageHash=createHash('sha256').update(buffer).digest('hex'),eventKey=accountId+':'+request.request_id;
    const old=db.prepare('SELECT id,status FROM agent_collection_images WHERE event_key=? OR (session_id=? AND user_id=? AND image_hash=?)').get(eventKey,session.id,m.user_id,imageHash);
    if(old){if(old.status==='failed'){db.prepare("UPDATE agent_collection_images SET status='processing',updated_at=? WHERE id=?").run(stamp(),old.id);schedule(()=>processImage(old.id).catch(onError));}return {request_id:request.request_id,status:['processing','failed'].includes(old.status)?'running':'answered',task_id:old.id,message:'这张图片已收到，不会重复计算',detail_url:''};}
    if(db.prepare('SELECT 1 FROM agent_collection_images WHERE session_id=? AND image_hash=? AND user_id<>?').get(session.id,imageHash,m.user_id)){
      notice(session,m,'这张图与另一位成员的截图相同，暂未计入。请发你自己的收入原图，或说明你本月的收入总额后再报齐。',request.request_id);return {request_id:request.request_id,status:'need_input',task_id:'',message:'请补充本人的收入截图或总额',detail_url:''};}
    if(db.prepare('SELECT count(*) n FROM agent_collection_images WHERE session_id=? AND user_id=?').get(session.id,m.user_id).n>=20)throw new HttpError(409,'本次截图较多，请先核对已提交的图片或说明本月总收入');
    const imageId=id();db.transaction(()=>{db.prepare('INSERT INTO agent_collection_images VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(imageId,session.id,m.user_id,eventKey,imageHash,buffer,mime,'processing',null,null,'',stamp(),stamp());
      db.prepare('UPDATE agent_collection_members SET done=0,manual_total=NULL WHERE session_id=? AND user_id=?').run(session.id,m.user_id);}).immediate();schedule(()=>processImage(imageId).catch(onError));
    return {request_id:request.request_id,status:'running',task_id:imageId,message:'图片已收到，正在识别',detail_url:''};}
  function scope(){const s=active();if(!s||s.status!=='collecting')return null;try{check(s);}catch{return null;}const list=rows(s.id);return {id:s.id,expires_at:s.expires_at,expires_unix:Math.floor(Date.parse(s.expires_at)/1000),expected_senders:list.map(m=>m.sender_id),pending_senders:list.filter(m=>JSON.parse(m.question_json).type==='source_month').map(m=>m.sender_id)};}
  function eligible(request){const s=active();if(!s||s.status!=='collecting'||s.id!==request.collection_id)return false;try{check(s);}catch{return false;}return rows(s.id).some(m=>m.sender_id===request.from_user);}
  function validateReply(sid){const s=get(sid);check(s);return ['awaiting_month','collecting','awaiting_owner'].includes(s.status);}
  function noticeTarget(row){const match=row.source_key.match(/^collection:([a-f0-9]{16}):(\d+):[a-f0-9]{16}$/);if(!match)throw new HttpError(403,'收集消息已失效');const s=get(match[1]);check(s);if(!['collecting','awaiting_owner'].includes(s.status))throw new HttpError(403,'收集已结束');const m=rows(s.id).find(m=>m.user_id===Number(match[2]));if(!m)throw new HttpError(403,'收集成员有变化');return {recipient_id:GROUP,group_id:GROUP,at_wxids:[m.sender_id]};}
  function finalize(sessionId,draftHash){const s=get(sessionId);check(s);if(s.status!=='awaiting_owner'||inputHash(s)!==draftHash)throw new HttpError(409,'截图或成员上报已变化，请重新核对');applyTotals(s);
    const saved=backend.runSettlement(s.team_id,s.month,{notify:false});if(hash(saved.result_json)!==hash(JSON.parse(s.preview_json).result_json))throw new HttpError(409,'结算与主人核对的预览不一致，未保存');
    db.prepare("UPDATE agent_collection_sessions SET status='published',updated_at=? WHERE id=?").run(stamp(),s.id);return saved;}
  return {handleText,submitImage,scope,eligible,validateReply,noticeTarget,finalize,monthFrom,cancel(sid){db.prepare("UPDATE agent_collection_sessions SET status='cancelled',updated_at=? WHERE id=?").run(stamp(),sid);},
    imageError(request){const s=active();if(!s||s.status!=='collecting'||!eligible(request))throw new HttpError(409,'请主人先发起本月工资收集');access(request,false);const m=rows(s.id).find(m=>m.sender_id===request.from_user);notice(s,m,'原图还没读取成功，请在微信重新发送清晰原图，我会在群里继续核对。',request.request_id);return {request_id:request.request_id,status:'need_input',message:'请在微信重新发送原图',task_id:'',detail_url:''};},
    taskStatus(imageId,request){const row=db.prepare('SELECT * FROM agent_collection_images WHERE id=?').get(imageId);if(!row)return null;const s=get(row.session_id);check(s);const actor=access(request,false);if(row.user_id!==actor.id)throw new HttpError(403,'只能查询本人截图');return {request_id:request.request_id,status:row.status==='processing'?'running':row.status==='failed'||row.status==='needs_input'?'need_input':'answered',task_id:row.id,message:row.status==='processing'?'图片正在识别':'图片核对状态：'+({'recognized':'已识别','needs_input':'需要补充月份','failed':'请补充清晰截图','superseded':'已由新图替代'}[row.status]||row.status),detail_url:''};},
    status(){const s=active();return s?{id:s.id,month:s.month,status:s.status,members:rows(s.id).map(m=>({name:m.name,done:!!m.done})),expires_at:s.expires_at}:null;},
    recover(){for(const r of db.prepare("SELECT id FROM agent_collection_images WHERE status='processing'").all())schedule(()=>processImage(r.id).catch(onError));}};
}
module.exports={createFinanceCollection,monthFrom};
