// Render saved settlement results only; all money is computed by the existing
// settlement service. Parts fit the shared WeChat queue without truncation.
function settlementMessage(team, saved) {
  const r=saved.result_json||{},fmt=n=>Number(n||0).toFixed(2),lines=[`【月度结算报告】${team.name} · ${saved.month}`,'━━━━━━━━━━━━━━━━━━━━',
    '💰 收支概览',`总收入：¥${fmt(r.total_income)}`,`总支出：¥${fmt(r.total_expense)}`,`可分配：¥${fmt(r.distributable)}`];
  if(Number(r.total_tax))lines.push(`退税：¥${fmt(r.total_tax)}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━','🧾 支出明细');
  if(r.expense_items?.length)r.expense_items.forEach((e,i)=>lines.push(`${i+1}. ${e.item_name||'未命名支出'}：¥${fmt(e.amount)}`,`支出人：${e.payer_name||'未填写'}`,`备注：${e.note||'无'}`));
  else lines.push(Number(r.total_expense)?'这份历史结算尚未保存支出项目，请在财务页面核对。':'本月无支出。');
  lines.push(`合计：¥${fmt(r.total_expense)}`,'━━━━━━━━━━━━━━━━━━━━','📊 同比对比');
  const year=Number(saved.month.slice(0,4)),mon=saved.month.slice(5);
  for(const [i,key] of ['year_compare_last','year_compare_prev2','year_compare_prev3'].entries())if(saved[key]!=null){const v=saved[key]/100,p=v>0?((Number(r.total_income)-v)/v*100):null;lines.push(`${['去年','前年','前前年'][i]}同月（${year-i-1}-${mon}）：¥${fmt(v)}${p===null?'':`（同比 ${p>=0?'+':''}${p.toFixed(1)}%）`}`);}
  lines.push('━━━━━━━━━━━━━━━━━━━━','👥 成员分账明细');
  for(const m of r.members||[]){const diff=Number(m.diff||0);lines.push(m.name,`净分成 ${m.net_share==null?'未拆分':'¥'+fmt(m.net_share)}　本人垫付 ${m.paid_expense==null?'未拆分':'¥'+fmt(m.paid_expense)}`,
    `应收 ¥${fmt(m.should_get)}　实收 ¥${fmt(m.actual)}　差额 ${diff>=0?'+':'-'}¥${fmt(Math.abs(diff))}（${Math.abs(diff)<0.01?'已平衡':diff>0?'待收':'需支付'}）`);
    const history=['last','prev2','prev3'].flatMap((key,i)=>{const cents=r.member_compare?.[key]?.[m.name];if(cents==null)return [];const value=cents/100,p=value>0?(Number(m.actual)/value-1)*100:null;return [`${year-i-1}-${mon}：¥${fmt(value)}${p===null?'':`（${p>=0?'+':''}${p.toFixed(1)}%）`}`];});
    if(history.length)lines.push('历史：'+history.join(' / '));
  }
  lines.push('━━━━━━━━━━━━━━━━━━━━','💸 最优转账方案');
  lines.push(...(r.transfers?.length?r.transfers.map(t=>`${t.from} → ${t.to}：¥${fmt(t.amount)}`):['本月无需转账。']));
  return lines.join('\n').replace(/\r\n?/g,'\n').replace(/[\x00-\x08\x0b-\x1f]/g,' ');
}
function messageParts(text, max=1200){
  const parts=[];let part='';
  for(const char of String(text)){if(part.length+char.length>max){parts.push(part);part='';}part+=char;}
  if(part)parts.push(part);return parts;
}
module.exports={settlementMessage,messageParts};
