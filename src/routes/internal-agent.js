const express = require('express');
const { timingSafeEqual } = require('crypto');

function createInternalAgentRouter({ service, settings, onError = () => {} }) {
  const router = express.Router();
  router.use(express.json({limit:'64kb',strict:true}));
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    const config=settings();
    if(!config.token || config.token.length<32 || !config.accountId || config.token===config.jwtSecret)
      return res.status(503).json(failure(req,'财务服务暂不可用，请稍后重试'));
    const auth=req.headers.authorization || '', supplied=auth.startsWith('Bearer ')?auth.slice(7):'';
    if(Buffer.byteLength(supplied)!==Buffer.byteLength(config.token) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(config.token)))
      return res.status(401).json(failure(req,'服务认证失败'));
    next();
  });
  function failure(req,message) { return {request_id:typeof req.body?.request_id==='string'?req.body.request_id.slice(0,200):'',status:'failed',message:`【性价屋·财务】${message}`,task_id:'',detail_url:''}; }
  const handle = fn => async (req,res,next)=>{try{res.json(await fn(req));}catch(error){next(error);}};
  router.post('/chat',handle(req=>service.respond ? service.respond(req.body) : service.chat(req.body)));
  router.post('/scope',handle(()=>service.ingressScope()));
  router.post('/authorize-response',handle(req=>service.authorizeResponse(req.body)));
  router.post('/tasks/:id/query',handle(req=>service.taskStatus(req.params.id,req.body)));
  router.post('/notifications/pull',handle(req=>service.pullNotifications(req.body)));
  router.post('/notifications/:id/receipt',handle(req=>service.notificationReceipt(req.params.id,req.body)));
  router.post('/notifications/:id/authorize',handle(req=>service.authorizeNotification(req.params.id,req.body)));
  router.use((error,req,res,next)=>{
    const known=[400,401,403,404,409,413,503].includes(error.status);
    const status=known?[403,404].includes(error.status)?200:error.status:503;
    if(!known)onError(error);
    const message=error.type==='entity.parse.failed'?'请求 JSON 无效':error.status===413?'请求体超过 64KB':known?error.message:'财务服务暂不可用，请稍后重试';
    res.set('Cache-Control','no-store').status(status).json(failure(req,message));
  });
  return router;
}
module.exports={createInternalAgentRouter};
