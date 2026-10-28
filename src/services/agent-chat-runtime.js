const { db } = require('../config/database');
const { env } = require('../config/env');
const { createAgentChatService } = require('./agent-chat-service');
const records = require('./record-service');
const settlements = require('./settlement-service');
const { getSettlement } = require('../models/settlement-model');
const fs = require('fs');
const path = require('path');

function settings() {
  let config={};try{config=JSON.parse(fs.readFileSync(process.env.FINANCE_AGENT_CHAT_CONFIG || path.join(__dirname,'../../data/finance-agent-chat.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')return {token:'',accountId:'',jwtSecret:env.jwtSecret};}
  return {token:process.env.FINANCE_AGENT_SERVICE_TOKEN || config.token || '',accountId:process.env.FINANCE_AGENT_ACCOUNT_ID || config.account_id || '',
    ownerId:process.env.FINANCE_AGENT_OWNER_ID || config.owner_id || 'ZML741213442',baseUrl:config.base_url || process.env.BASE_URL || '',jwtSecret:env.jwtSecret};
}
const service = createAgentChatService({db,accountId:settings().accountId,ownerId:settings().ownerId,baseUrl:settings().baseUrl,
  backend:{addRecord:records.addRecord,editRecord:records.editRecord,previewSettlement:settlements.previewSettlement,
    runSettlement:settlements.runSettlement,fetchSettlement:getSettlement},onError:error=>console.error('[finance-chat]',error.name)});
service.recover();
module.exports={service,settings};
