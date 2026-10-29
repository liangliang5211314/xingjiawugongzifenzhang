const fs=require('fs');
const path=require('path');
const {HttpError}=require('../utils/http-error');
async function recognize(buffer,mime){
  const file=process.env.FINANCE_AGENT_CONFIG||path.join(__dirname,'../../data/finance-agent-private.json');
  let config={};try{config=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  if(!config.bridge_token||config.recognize_url!=='https://zf.xingjiawu.cn/api/finance-agent/recognize')throw new HttpError(503,'识图暂时不可用，请稍后重试');
  const response=await fetch(config.recognize_url,{method:'POST',headers:{'Content-Type':'application/json','X-Finance-Token':config.bridge_token},
    body:JSON.stringify({image_base64:buffer.toString('base64'),mime_type:mime}),signal:AbortSignal.timeout(70000),redirect:'error'});
  if(!response.ok)throw new HttpError(503,'识图暂时不可用，原图已保留');
  const value=await response.json();if(!value.ok||!value.extraction)throw new HttpError(503,'这张图片还没识别清楚，请稍后重试');return value.extraction;
}
module.exports={recognize};
