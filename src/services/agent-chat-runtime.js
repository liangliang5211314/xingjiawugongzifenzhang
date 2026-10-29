const { db } = require('../config/database');
const { env } = require('../config/env');
const { createAgentChatService } = require('./agent-chat-service');
const records = require('./record-service');
const settlements = require('./settlement-service');
const { getSettlement } = require('../models/settlement-model');
const fs = require('fs');
const path = require('path');
const {createFinanceCollection}=require('./finance-collection-service');
const {recognize}=require('./finance-vision');
let collection;

function settings() {
  let config={};try{config=JSON.parse(fs.readFileSync(process.env.FINANCE_AGENT_CHAT_CONFIG || path.join(__dirname,'../../data/finance-agent-chat.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')return {token:'',accountId:'',jwtSecret:env.jwtSecret};}
  return {token:process.env.FINANCE_AGENT_SERVICE_TOKEN || config.token || '',accountId:process.env.FINANCE_AGENT_ACCOUNT_ID || config.account_id || '',
    ownerId:process.env.FINANCE_AGENT_OWNER_ID || config.owner_id || 'ZML741213442',baseUrl:config.base_url || process.env.BASE_URL || '',jwtSecret:env.jwtSecret};
}
const service = createAgentChatService({db,accountId:settings().accountId,ownerId:settings().ownerId,baseUrl:settings().baseUrl,
  getCollection:()=>collection,
  interpret:async input=>{
    const config=settings();
    const response=await fetch('https://zf.xingjiawu.cn/api/finance-agent/interpret',{
      method:'POST',headers:{'Content-Type':'application/json','X-Finance-Chat-Token':config.token},
      body:JSON.stringify(input),signal:AbortSignal.timeout(3400),redirect:'error'});
    if(!response.ok)throw new Error('Finance understanding unavailable');
    const result=await response.json();if(!result.ok)throw new Error('Finance understanding unavailable');return result.plan;
  },
  backend:{addRecord:records.addRecord,editRecord:records.editRecord,previewSettlement:settlements.previewSettlement,
    runSettlement:settlements.runSettlement,fetchSettlement:getSettlement,markSettlementPushed:settlements.markSettlementPushed},onError:error=>console.error('[finance-chat]',error.name)});
service.recover();
collection=createFinanceCollection({db,accountId:settings().accountId,ownerId:settings().ownerId,recognize,
  backend:{addRecord:records.addRecord,previewSettlement:settlements.previewSettlement,runSettlement:settlements.runSettlement},
  access:service.collectionAccess,policy:service.collectionPolicy,members:service.collectionMembers,review:service.requestCollectionReview,
  notice:(session,member,message,key)=>service.enqueueNotification({source_key:`collection:${session.id}:${member.user_id}:${require('crypto').createHash('sha256').update(key).digest('hex').slice(0,16)}`,from_user:settings().ownerId,team_id:session.team_id,month:session.month,kind:'collection_notice',message:'@'+member.name+' '+message}),
  onError:error=>console.error('[finance-collection]',error.name)});
collection.recover();
settlements.setSettlementSavedHandler(saved=>service.requestGroupReview(saved));
module.exports={service,settings};
