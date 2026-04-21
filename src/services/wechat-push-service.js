const axios = require('axios');
const { env } = require('../config/env');
const { listUsers } = require('../models/user-model');
const { createPushLog } = require('../models/push-log-model');
const { markSettlementPushed } = require('./settlement-service');
const { fromCents } = require('../utils/money');

let _accessToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;
  const res = await axios.get(
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${env.wxAppId}&secret=${env.wxSecret}`
  );
  if (res.data.errcode) throw new Error(`微信获取access_token失败: ${res.data.errmsg}`);
  _accessToken = res.data.access_token;
  _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return _accessToken;
}

// 发送单条模板消息
async function sendTemplate(openid, templateId, data, url) {
  const token = await getAccessToken();
  const body = {
    touser: openid,
    template_id: templateId,
    url: url || `${env.baseUrl}/h5/home`,
    data,
  };
  const res = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${token}`,
    body
  );
  return { request: body, response: res.data, ok: res.data.errcode === 0 };
}

/**
 * 推送某次结算结果给所属团队的所有成员
 * @param {object} settlement - settlements表记录（含result_json已解析）
 * @returns {object} 推送结果汇总
 */
async function pushSettlement(settlement) {
  if (!env.wxAppId || !env.wxTemplateId) throw new Error('微信推送未配置（WX_APPID/WX_TEMPLATE_ID）');

  const result = settlement.result_json;
  if (!result) throw new Error('结算数据为空');

  // 获取团队成员（有openid的才能推）
  const members = listUsers({ teamId: settlement.team_id, role: 'member' });
  const openidMap = new Map(members.filter(m => m.openid).map(m => [m.name, m.openid]));

  const memberResults = result.members || [];
  const logs = [];

  for (const m of memberResults) {
    const openid = openidMap.get(m.name);
    if (!openid) {
      logs.push({ name: m.name, status: 'skipped', reason: '未绑定微信' });
      continue;
    }

    // 构造模板消息数据（与微信模板字段对应）
    const templateData = {
      first:    { value: `【${result.team_name}】${settlement.month} 结算通知`, color: '#173177' },
      keyword1: { value: settlement.month },
      keyword2: { value: `¥${result.total_income}` },
      keyword3: { value: `¥${m.should_get}` },
      keyword4: { value: `¥${m.diff}` },
      remark: {
        value: [
          settlement.year_compare_last  != null ? `去年同月: ¥${fromCents(settlement.year_compare_last)}` : '',
          settlement.year_compare_prev2 != null ? `前年同月: ¥${fromCents(settlement.year_compare_prev2)}` : '',
          '点击查看详情',
        ].filter(Boolean).join('\n'),
      },
    };

    let pushResult;
    try {
      pushResult = await sendTemplate(openid, env.wxTemplateId, templateData);
    } catch (e) {
      pushResult = { request: templateData, response: { errmsg: e.message }, ok: false };
    }

    // 找到对应user_id
    const userObj = members.find(u => u.name === m.name);
    createPushLog({
      settlement_id: settlement.id,
      user_id: userObj?.id || null,
      openid,
      push_type: 'wechat_template',
      request_json: pushResult.request,
      response_json: pushResult.response,
      status: pushResult.ok ? 'success' : 'failed',
    });

    logs.push({ name: m.name, openid, status: pushResult.ok ? 'success' : 'failed', response: pushResult.response });
  }

  // 标记推送时间
  markSettlementPushed(settlement.id);

  return {
    total: memberResults.length,
    pushed: logs.filter(l => l.status === 'success').length,
    failed: logs.filter(l => l.status === 'failed').length,
    skipped: logs.filter(l => l.status === 'skipped').length,
    logs,
  };
}

module.exports = { pushSettlement };
