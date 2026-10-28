const { randomBytes, createHash } = require('crypto');
const { HttpError } = require('../utils/http-error');

const GROUP_ID = '19116819870@chatroom';
const MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const clean = (v, size = 160) => String(v || '').trim().slice(0, size);
function cents(value) {
  const text = String(value);
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw new HttpError(400, '金额必须为正数，最多两位小数');
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!amount) throw new HttpError(400, '金额不能为零');
  return amount;
}
function imageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > 3 * 1024 * 1024) throw new HttpError(400, '请提供不超过 3MB 的原图');
  if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new HttpError(400, '仅支持 JPEG、PNG、WebP 原图');
}

function createFinanceAgent({ db, recognize, previewSettlement, publishSettlement, clock = () => new Date(), onError = () => {} }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_scope (
      group_id TEXT PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id), account_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS finance_bindings (
      account_id TEXT NOT NULL, group_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id), updated_by INTEGER NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(account_id, group_id, sender_id)
    );
    CREATE TABLE IF NOT EXISTS finance_submissions (
      id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, account_id TEXT NOT NULL, group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL, team_id INTEGER NOT NULL REFERENCES teams(id), user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL, image_hash TEXT, image_data BLOB, mime_type TEXT,
      extraction_json TEXT, month TEXT, source_month TEXT, selected_json TEXT, record_ids_json TEXT,
      question TEXT NOT NULL DEFAULT '', audit_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_finance_pending ON finance_submissions(team_id,status,created_at);
    CREATE TABLE IF NOT EXISTS finance_outbox (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, group_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      message TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_message_events (
      event_key TEXT PRIMARY KEY, reply TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS finance_completions (
      team_id INTEGER NOT NULL, user_id INTEGER NOT NULL, month TEXT NOT NULL, completed INTEGER NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(team_id,user_id,month)
    );
    CREATE TABLE IF NOT EXISTS finance_reviews (
      id TEXT PRIMARY KEY, team_id INTEGER NOT NULL, month TEXT NOT NULL, source_hash TEXT NOT NULL,
      result_json TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  const stamp = () => clock().toISOString();
  const getScope = () => db.prepare('SELECT * FROM finance_scope WHERE group_id=?').get(GROUP_ID);
  const get = id => db.prepare('SELECT * FROM finance_submissions WHERE id=?').get(id);
  const publicRow = row => {
    if (!row) return null;
    const { image_data, extraction_json, selected_json, record_ids_json, audit_json, ...rest } = row;
    return { ...rest, has_image: row.has_image === 1 || !!image_data, extraction: JSON.parse(extraction_json || 'null'),
      selected: JSON.parse(selected_json || 'null'), record_ids: JSON.parse(record_ids_json || '[]'), audit: JSON.parse(audit_json || '[]') };
  };
  function member(userId, teamId) {
    const user = db.prepare('SELECT id,name,status,team_id FROM users WHERE id=?').get(Number(userId));
    if (!user || user.status !== 1 || !user.name || !(user.team_id === teamId ||
      db.prepare('SELECT 1 FROM user_teams WHERE user_id=? AND team_id=?').get(user.id, teamId))) throw new HttpError(400, '成员不属于该团队或已停用');
    return user;
  }
  function configure({ team_id, account_id, enabled, owner_id }) {
    const team = db.prepare('SELECT id,status FROM teams WHERE id=?').get(Number(team_id));
    if (!team || team.status !== 1 || !clean(account_id)) throw new HttpError(400, '请选择有效团队并填写托管微信账号 ID');
    const owner = clean(owner_id || getScope()?.owner_id, 200);
    if (owner && !/^[A-Za-z0-9_.-]{1,160}(?:@openim)?$/.test(owner)) throw new HttpError(400, '主人联系人 ID 无效');
    db.prepare(`INSERT INTO finance_scope (group_id,team_id,account_id,enabled,updated_at,owner_id) VALUES (?,?,?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET
      team_id=excluded.team_id,account_id=excluded.account_id,enabled=excluded.enabled,updated_at=excluded.updated_at,owner_id=excluded.owner_id`)
      .run(GROUP_ID, team.id, clean(account_id), enabled === true ? 1 : 0, stamp(), owner);
    return getScope();
  }
  function bind({ sender_id, user_id, previous_user_id }, actorId) {
    const scope = getScope();
    if (!scope) throw new HttpError(400, '请先配置财务群');
    const user = member(Number(user_id), scope.team_id);
    const sender = clean(sender_id, 200);
    if (!sender) throw new HttpError(400, '缺少微信发送者 ID');
    const old = db.prepare('SELECT user_id FROM finance_bindings WHERE account_id=? AND group_id=? AND sender_id=?')
      .get(scope.account_id, GROUP_ID, sender);
    if (old && old.user_id !== user.id && Number(previous_user_id) !== old.user_id) throw new HttpError(409, '该微信已绑定其他成员，请明确确认原成员后重新绑定');
    db.prepare(`INSERT INTO finance_bindings VALUES (?,?,?,?,?,?) ON CONFLICT(account_id,group_id,sender_id)
      DO UPDATE SET user_id=excluded.user_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(scope.account_id, GROUP_ID, sender, user.id, actorId, stamp());
    return user;
  }
  function binding(account, sender) {
    const scope = getScope();
    const bound = db.prepare('SELECT user_id FROM finance_bindings WHERE account_id=? AND group_id=? AND sender_id=?').get(account, GROUP_ID, sender);
    return scope && bound ? member(bound.user_id, scope.team_id) : null;
  }
  function queue(row, text, suffix) {
    if (row.account_id.startsWith('web:')) return;
    db.prepare('INSERT OR IGNORE INTO finance_outbox VALUES (?,?,?,?,?,?,?,?)')
      .run(`finance:${row.id}:${suffix}`, row.account_id, row.recipient_id || GROUP_ID, row.recipient_id ? '' : row.sender_id, clean(text, 1800), 'queued', stamp(), stamp());
  }
  function audit(row, action, actor) {
    return JSON.stringify([...JSON.parse(row.audit_json || '[]'), { action, actor, at: stamp() }].slice(-50));
  }
  function normalize(extraction) {
    if (!extraction || !Array.isArray(extraction.transactions) || extraction.transactions.length > 80) throw new HttpError(400, '图片识别结果不完整，请重传清晰原图');
    const transactions = extraction.transactions.map(t => {
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(t.date) || Number.isNaN(Date.parse(t.date)) || new Date(t.date).toISOString().slice(0, 10) !== t.date) throw new HttpError(400, '交易日期无法辨认，请人工核对');
      if (!['income', 'expense', 'refund'].includes(t.type)) throw new HttpError(400, '存在无法判断的收支类型，请人工核对');
      return { date: t.date, amount: (cents(t.amount) / 100).toFixed(2), type: t.type, description: clean(t.description, 200) };
    });
    if (!transactions.length) throw new HttpError(400, '未识别到交易明细，请补充原图或人工录入');
    const monthly_totals = Array.isArray(extraction.monthly_totals) ? extraction.monthly_totals.filter(t => MONTH.test(t.month))
      .map(t => ({ month: t.month, amount: (cents(t.amount) / 100).toFixed(2) })) : [];
    return { transactions, monthly_totals };
  }
  function select(row, sourceMonth) {
    const extraction = JSON.parse(row.extraction_json || 'null');
    if (!extraction) throw new HttpError(409, '识图尚未完成或需要重试');
    const entries = extraction.transactions.filter(t => t.date.startsWith(sourceMonth));
    if (!entries.length) throw new HttpError(400, '图片中没有这个月份的交易');
    if (entries.some(t => t.type === 'refund')) throw new HttpError(409, '这个月份含退款，请管理员先确认退款的财务归类');
    if (new Set(entries.map(t => t.type)).size !== 1) throw new HttpError(409, '同一图片月份包含收入和支出，请拆分后核对');
    const amount = entries.reduce((sum, t) => sum + cents(t.amount), 0);
    const total = extraction.monthly_totals.find(t => t.month === sourceMonth);
    if (total && cents(total.amount) !== amount) throw new HttpError(409, '逐笔金额与图片月度汇总不一致，请提供完整图片');
    return { entries, amount, type: entries[0].type };
  }
  const processing = new Set();
  async function process(id) {
    if (processing.has(id)) return publicRow(get(id));
    processing.add(id);
    try { return await processOnce(id); } finally { processing.delete(id); }
  }
  async function processOnce(id) {
    let row = get(id);
    if (!row || !['processing', 'unbound', 'recognition_failed'].includes(row.status)) return publicRow(row);
    try {
      if (!row.user_id) {
        const user = binding(row.account_id, row.sender_id);
        if (!user) throw new HttpError(409, '请管理员先在财务 Agent 页面绑定发图人的成员身份，再点击重新识别');
        db.prepare('UPDATE finance_submissions SET user_id=?,status=? WHERE id=?').run(user.id, 'processing', id);
        row = get(id);
      }
      member(row.user_id, row.team_id);
      const extraction = normalize(await recognize(row.image_data, row.mime_type));
      const sourceMonth = extraction.transactions.map(t => t.date.slice(0, 7)).sort().at(-1);
      db.prepare('UPDATE finance_submissions SET extraction_json=?,source_month=?,status=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(extraction), sourceMonth, 'awaiting_confirmation', stamp(), id);
      row = get(id);
      let question;
      try {
        const selected = select(row, sourceMonth);
        const user = member(row.user_id, row.team_id);
        question = `识别到 ${sourceMonth} ${selected.type === 'income' ? '收入' : '支出'} ¥${(selected.amount / 100).toFixed(2)}，归属 ${user.name}${selected.type === 'expense' ? '，待确认本人垫付' : ''}。` +
          `请确认结算月份，例如回复“确认 ${id} 2026-10”；如需选择图片中的其他月份，请在财务页面核对。`;
      } catch (error) { question = error.message; }
      db.prepare('UPDATE finance_submissions SET question=? WHERE id=?').run(question, id);
      queue(row, `【财务核对 ${id}】${question}`, 'recognized');
    } catch (error) {
      const status = row.user_id ? 'recognition_failed' : 'unbound';
      const question = error instanceof HttpError ? error.message : '识图服务暂时不可用，原图已保留，请稍后在财务页面重试';
      db.prepare('UPDATE finance_submissions SET status=?,question=?,updated_at=? WHERE id=?').run(status, question, stamp(), id);
      queue(row, `【财务核对 ${id}】${question}`, 'needs-help');
      if (!(error instanceof HttpError)) onError(error);
    }
    return publicRow(get(id));
  }
  function submit({ account_id, sender_id, message_id, image, user_id, actor_id }) {
    const scope = getScope();
    if (!scope?.enabled) throw new HttpError(409, '财务 Agent 尚未启用');
    const web = String(account_id).startsWith('web:');
    if (!web && account_id !== scope.account_id) throw new HttpError(403, '微信账号不匹配');
    const eventKey = `${account_id}:${GROUP_ID}:${clean(message_id, 200)}`;
    const previous = db.prepare('SELECT * FROM finance_submissions WHERE event_key=?').get(eventKey);
    if (previous) return publicRow(previous);
    const mime = imageType(image);
    const hash = createHash('sha256').update(image).digest('hex');
    const user = web ? member(Number(user_id), scope.team_id) : binding(account_id, sender_id);
    const duplicate = db.prepare('SELECT * FROM finance_submissions WHERE image_hash=? AND team_id=? AND sender_id=? AND account_id=? AND status<>?')
      .get(hash, scope.team_id, sender_id, account_id, 'cancelled');
    if (duplicate) {
      queue(duplicate, `这张图片已收到，凭证 ${duplicate.id} 当前${duplicate.status === 'posted' ? '已入账，不会重复记账' : '仍待核对，请处理原凭证'}。`, `duplicate-${clean(message_id)}`);
      return publicRow(duplicate);
    }
    const id = randomBytes(6).toString('hex');
    db.prepare(`INSERT INTO finance_submissions
      (id,event_key,account_id,group_id,sender_id,team_id,user_id,status,image_hash,image_data,mime_type,audit_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, eventKey, account_id, GROUP_ID, clean(sender_id, 200), scope.team_id,
      user?.id || null, user ? 'processing' : 'unbound', hash, image, mime,
      JSON.stringify([{action:'received',actor:actor_id || sender_id,at:stamp()}]), stamp(), stamp());
    setImmediate(() => process(id).catch(onError));
    return publicRow(get(id));
  }
  function confirm(id, { month, source_month, use_existing_id, payer_user_id }, actor = {}) {
    return db.transaction(() => {
      const row = get(id);
      if (!row) throw new HttpError(404, '凭证不存在');
      if (!actor.admin && (actor.account_id !== row.account_id || actor.sender_id !== row.sender_id)) throw new HttpError(403, '只能确认本人提交的凭证');
      const scope = getScope();
      if (!scope?.enabled || scope.team_id !== row.team_id || (!actor.admin && scope.account_id !== row.account_id)) throw new HttpError(409, '群配置已变化，请管理员核对');
      const user = member(row.user_id, row.team_id);
      if (!actor.admin && binding(row.account_id, row.sender_id)?.id !== user.id) throw new HttpError(409, '成员绑定已变化，请管理员核对');
      if (row.status === 'posted') return publicRow(row);
      if (row.status !== 'awaiting_confirmation') throw new HttpError(409, '这张凭证尚不能入账');
      if (!MONTH.test(month) || !MONTH.test(source_month || row.source_month)) throw new HttpError(400, '请明确 YYYY-MM 格式的结算月份');
      const selected = select(row, source_month || row.source_month);
      const payer = selected.type === 'expense' && payer_user_id && actor.admin ? member(Number(payer_user_id), row.team_id) : user;
      const sourceRecords = db.prepare('SELECT * FROM income_records WHERE team_id=? AND month=? AND person_name=? AND item_type=?')
        .all(row.team_id, month, user.name, selected.type);
      const exact = sourceRecords.filter(r => Math.abs(r.amount) === selected.amount && (selected.type !== 'expense' || (r.payer_name || r.person_name) === payer.name));
      let recordId;
      if (use_existing_id) {
        if (!actor.admin || !exact.some(r => r.id === Number(use_existing_id))) throw new HttpError(400, '仅管理员可关联金额、成员和月份完全相符的现有记录');
        recordId = Number(use_existing_id);
      } else {
        if (exact.length) throw new HttpError(409, `已有同成员同月同金额记录（${exact.map(r => r.id).join('、')}），请管理员关联现有记录，避免重复入账`);
        const posted = db.prepare('SELECT selected_json FROM finance_submissions WHERE team_id=? AND user_id=? AND status=?').all(row.team_id, user.id, 'posted');
        const fingerprint = entry => `${entry.date}|${entry.type}|${cents(entry.amount)}|${entry.description.replace(/\s/g, '')}`;
        const old = new Set(posted.flatMap(p => JSON.parse(p.selected_json || '{}').entries || []).map(fingerprint));
        if (selected.entries.some(e => old.has(fingerprint(e)))) throw new HttpError(409, '与已入账凭证存在重复交易，请管理员核对');
        recordId = Number(db.prepare(`INSERT INTO income_records
          (team_id,month,person_name,item_type,item_name,amount,payer_name,note,created_by) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(row.team_id, month, user.name, selected.type, selected.type === 'income' ? '图片收入' : '图片支出', selected.amount,
            selected.type === 'expense' ? payer.name : null, `财务凭证 ${id}；图片月份 ${source_month || row.source_month}`, actor.admin || user.id).lastInsertRowid);
      }
      db.prepare(`UPDATE finance_submissions SET status='posted',month=?,source_month=?,selected_json=?,record_ids_json=?,audit_json=?,updated_at=? WHERE id=?`)
        .run(month, source_month || row.source_month, JSON.stringify(selected), JSON.stringify([recordId]), audit(row, use_existing_id ? 'linked_existing' : 'confirmed_and_posted', actor.admin || actor.sender_id), stamp(), id);
      db.prepare('UPDATE finance_completions SET completed=0,updated_at=? WHERE team_id=? AND user_id=? AND month=?').run(stamp(), row.team_id, user.id, month);
      queue(row, `【财务入账 ${id}】${user.name} ${month} ${selected.type === 'income' ? '收入' : '支出'} ¥${(selected.amount / 100).toFixed(2)} 已确认${use_existing_id ? '并关联现有记录' : '入账'}。`, 'posted');
      return publicRow(get(id));
    }).immediate();
  }
  function cancel(id, actorId) {
    const row = get(id);
    if (!row) throw new HttpError(404, '凭证不存在');
    if (row.status === 'posted') throw new HttpError(409, '已入账凭证请在台账中更正，不能直接取消');
    db.prepare("UPDATE finance_submissions SET status='cancelled',audit_json=?,updated_at=? WHERE id=?")
      .run(audit(row, 'admin_cancelled', actorId), stamp(), id);
    return publicRow(get(id));
  }
  function receiveText(event) {
    const key = `${event.account_id}:${GROUP_ID}:${event.message_id}`;
    const old = db.prepare('SELECT reply FROM finance_message_events WHERE event_key=?').get(key);
    if (old) return old.reply;
    const text = clean(event.content, 500);
    if (/财务统计|财务结算|报齐/.test(text)) {
      const user = binding(event.account_id, event.from_user);
      if (!user) return '';
      const match = text.match(/(20\d{2})[-年](\d{1,2})月?/);
      let reply;
      if (!match) reply = '请明确月份，例如“2026-11 已报齐”或“财务统计 2026-11”。';
      else {
        const month = `${match[1]}-${match[2].padStart(2, '0')}`, scope = getScope();
        try {
          if (!MONTH.test(month)) throw new HttpError(400, '月份无效');
          if (/报齐/.test(text)) {
            if (db.prepare("SELECT 1 FROM finance_submissions WHERE team_id=? AND user_id=? AND status NOT IN ('posted','cancelled') LIMIT 1").get(scope.team_id, user.id)) throw new HttpError(409, '你还有待核对凭证，请先处理后再报齐');
            db.prepare('INSERT INTO finance_completions VALUES (?,?,?,?,?) ON CONFLICT(team_id,user_id,month) DO UPDATE SET completed=1,updated_at=excluded.updated_at').run(scope.team_id, user.id, month, 1, stamp());
            reply = `${user.name} ${month} 已确认报齐。`;
          } else reply = `统计 ${month} 将先发送给主人审核。`;
          try { requestReview(month); reply += '本月数据已齐，已生成主人私聊审核单。'; }
          catch (error) { if (!/报齐/.test(text)) throw error; }
        } catch (error) { reply = error instanceof HttpError ? error.message : '统计尚未完成，请管理员核对'; }
      }
      db.prepare('INSERT OR IGNORE INTO finance_message_events VALUES (?,?,?)').run(key, reply, stamp());
      queue({id:`text-${event.message_id}`,account_id:event.account_id,sender_id:event.from_user},reply,'reply');
      return reply;
    }
    if (!/财务|确认|取消|[12]\d{3}年|20\d{2}-\d{2}|\d{1,2}月|^[对是好没问题]+[的吧啊。！!]*$/.test(text)) return '';
    const user = binding(event.account_id, event.from_user);
    if (!user) return '';
    const idMatch = text.match(/\b[a-f0-9]{12}\b/);
    const pending = db.prepare(`SELECT * FROM finance_submissions WHERE account_id=? AND sender_id=? AND group_id=? AND status NOT IN ('posted','cancelled') ORDER BY created_at DESC`).all(event.account_id, event.from_user, GROUP_ID);
    const row = idMatch ? pending.find(r => r.id === idMatch[0]) : pending.length === 1 ? pending[0] : null;
    let reply = '';
    if (!row) reply = pending.length > 1 ? `有多张待核对凭证，请带上单号：${pending.slice(0, 5).map(r => r.id).join('、')}` : '当前没有待确认凭证，可在本群发送收入或支出原图。';
    else if (/^取消(?:\s|[a-f0-9]|$)/.test(text)) {
      db.prepare("UPDATE finance_submissions SET status='cancelled',audit_json=?,updated_at=? WHERE id=?").run(audit(row, 'cancelled', event.from_user), stamp(), row.id);
      reply = `已取消凭证 ${row.id}，没有入账。`;
    } else {
      const fullMonth = text.match(/(20\d{2})[-年](\d{1,2})月?/);
      const simpleMonth = text.match(/(?:算|记|是|属于|按)?\s*(\d{1,2})月/);
      let month = fullMonth ? `${fullMonth[1]}-${fullMonth[2].padStart(2, '0')}` : simpleMonth && row.source_month ? `${row.source_month.slice(0, 4)}-${simpleMonth[1].padStart(2, '0')}` : row.month;
      if (/本月/.test(text)) month = new Date(clock().getTime() + 8 * 3600000).toISOString().slice(0, 7);
      if (!month) reply = `凭证 ${row.id}：请明确结算月份，例如“确认 ${row.id} 2026-10”。图片到账月份与佣金结算月份可能不同。`;
      else if (!/^(?:确认|对的?|是的?|好的?|没问题)(?:\s+[a-f0-9]{12})?(?:\s+20\d{2}[-年]\d{1,2}月?)?[。！!\s]*$/.test(text)) {
        db.prepare('UPDATE finance_submissions SET month=?,updated_at=? WHERE id=?').run(month, stamp(), row.id);
        reply = `凭证 ${row.id} 将记入 ${month}。请回复“确认 ${row.id}”后入账。`;
      } else {
        try { confirm(row.id, { month }, { account_id:event.account_id, sender_id:event.from_user }); reply = ''; }
        catch (error) { reply = error instanceof HttpError ? error.message : '确认失败，单据已保留，请管理员核对'; }
      }
    }
    db.prepare('INSERT OR IGNORE INTO finance_message_events VALUES (?,?,?)').run(key, reply, stamp());
    if (reply) queue(row || {id:`text-${event.message_id}`,account_id:event.account_id,sender_id:event.from_user}, `【财务核对】${reply}`, `reply-${event.message_id}`);
    return reply;
  }
  function exchange(payload) {
    const scope = getScope();
    if (!scope?.enabled || payload.proxy_account_id !== scope.account_id || !Array.isArray(payload.accounts) ||
      payload.accounts.filter(a => a.id === scope.account_id && a.online === true).length !== 1) return { listen: null, ack: null, command: null };
    const receipt = payload.receipt;
    if (receipt?.type === 'send' && String(receipt.id).startsWith('finance:')) {
      db.prepare("UPDATE finance_outbox SET state=?,updated_at=? WHERE id=? AND state='dispatched'")
        .run(['accepted','failed'].includes(receipt.state) ? receipt.state : 'uncertain', stamp(), receipt.id);
    }
    const event = payload.inbox;
    let ack = null;
    if (event?.channel === 'finance' && event.account_id === scope.account_id && event.message_id &&
      (event.group_id === GROUP_ID || !event.group_id && event.from_user === scope.owner_id) &&
      Number.isFinite(event.create_time) && Math.abs(clock().getTime() / 1000 - event.create_time) >= 900) {
      // Retire expired queued messages without posting or blocking unrelated fault messages.
      ack = `${event.account_id}:${event.message_id}`;
      queue({id:`expired-${event.message_id}`,account_id:event.account_id,sender_id:event.from_user,
        ...(event.group_id ? {} : {recipient_id:scope.owner_id})},'这条财务消息已超出处理时限，没有自动入账或发布，请重新发送。','expired');
    }
    if (event?.channel === 'finance' && event.account_id === scope.account_id && !event.is_group && !event.group_id &&
      event.from_user === scope.owner_id && event.message_type === 1 && event.message_id &&
      Math.abs(clock().getTime() / 1000 - Number(event.create_time)) < 900) {
      ownerReply(event);
      ack = `${event.account_id}:${event.message_id}`;
    }
    if (event?.channel === 'finance' && event.account_id === scope.account_id && event.group_id === GROUP_ID &&
      event.from_user && event.message_id && Number.isFinite(event.create_time) && Math.abs(clock().getTime() / 1000 - event.create_time) < 900) {
      if (event.message_type === 3 && typeof event.image_base64 === 'string' && event.image_base64.length < 4.2 * 1024 * 1024) {
        try { submit({ account_id:event.account_id, sender_id:event.from_user, message_id:event.message_id, image:Buffer.from(event.image_base64, 'base64') }); }
        catch (error) {
          if (!(error instanceof HttpError)) throw error;
          queue({id:`invalid-${event.message_id}`,account_id:event.account_id,sender_id:event.from_user},
            `本次没有入账：${error.message}。请管理员核对后重新提交。`,'rejected');
        }
      } else if (event.message_type === 1) receiveText(event);
      else if (event.media_error) {
        const key = `${event.account_id}:${GROUP_ID}:${event.message_id}`;
        const reply = '图片暂时无法下载，请发送清晰原图或在财务页面上传；本次没有入账。';
        db.prepare('INSERT OR IGNORE INTO finance_message_events VALUES (?,?,?)').run(key, reply, stamp());
        queue({id:`media-${event.message_id}`,account_id:event.account_id,sender_id:event.from_user},reply,'error');
      }
      ack = `${event.account_id}:${event.message_id}`;
    }
    let command = null;
    db.prepare("UPDATE finance_outbox SET state='uncertain',updated_at=? WHERE state='dispatched' AND updated_at<?")
      .run(stamp(), new Date(clock().getTime() - 120000).toISOString());
    if (payload.ready === true) db.transaction(() => {
      const row = db.prepare("SELECT * FROM finance_outbox WHERE account_id=? AND group_id IN (?,?) AND state='queued' ORDER BY created_at LIMIT 1").get(scope.account_id, GROUP_ID, scope.owner_id);
      if (row) {
        db.prepare("UPDATE finance_outbox SET state='dispatched',updated_at=? WHERE id=?").run(stamp(), row.id);
        command = {type:'send',id:row.id,account_id:row.account_id,recipient_id:row.group_id,message:row.message,at_wxids:row.sender_id ? [row.sender_id] : []};
      }
    }).immediate();
    const pending = db.prepare("SELECT DISTINCT sender_id FROM finance_submissions WHERE account_id=? AND group_id=? AND status NOT IN ('posted','cancelled') LIMIT 100").all(scope.account_id, GROUP_ID);
    return { listen:{account_id:scope.account_id,group_id:GROUP_ID,owner_id:scope.owner_id,pending_senders:pending.map(r => r.sender_id)}, ack, command };
  }
  function sourceHash(teamId, month) {
    const records = db.prepare('SELECT * FROM income_records WHERE team_id=? AND month=? ORDER BY id').all(teamId, month);
    const rules = db.prepare('SELECT * FROM team_rule_members WHERE team_id=? ORDER BY id').all(teamId);
    const team = db.prepare('SELECT * FROM teams WHERE id=?').get(teamId);
    const members = db.prepare(`SELECT u.id,u.name,u.status,u.jd_account FROM users u WHERE u.team_id=? OR
      EXISTS(SELECT 1 FROM user_teams ut WHERE ut.user_id=u.id AND ut.team_id=?) ORDER BY u.id`).all(teamId, teamId);
    return createHash('sha256').update(JSON.stringify({records,rules,team,members})).digest('hex');
  }
  function requestReview(month, { admin, confirmed_complete } = {}) {
    return db.transaction(() => {
      const scope = getScope();
      if (!scope?.enabled || !scope.owner_id || !previewSettlement) throw new HttpError(409, '请先核验主人 ZML741213442 的稳定联系人 ID');
      if (!MONTH.test(month)) throw new HttpError(400, '请明确结算月份');
      if (db.prepare("SELECT 1 FROM finance_submissions WHERE team_id=? AND status NOT IN ('posted','cancelled') LIMIT 1").get(scope.team_id)) throw new HttpError(409, '还有待核对凭证，暂不能生成最终统计');
      const team = db.prepare('SELECT * FROM teams WHERE id=?').get(scope.team_id);
      const configured = JSON.parse(team.report_member_names || '[]');
      const names = configured.length ? configured : db.prepare('SELECT member_name FROM team_rule_members WHERE team_id=? ORDER BY id').all(scope.team_id).map(r => r.member_name);
      if (!names.length) throw new HttpError(409, '尚未设置本月需要报齐的成员');
      const done = db.prepare(`SELECT u.name FROM finance_completions c JOIN users u ON u.id=c.user_id WHERE c.team_id=? AND c.month=? AND c.completed=1`).all(scope.team_id, month).map(r => r.name);
      const missing = names.filter(name => !done.includes(name));
      if (missing.length && !(admin && confirmed_complete === true)) throw new HttpError(409, `尚未确认报齐：${missing.join('、')}`);
      const hash = sourceHash(scope.team_id, month);
      const old = db.prepare("SELECT * FROM finance_reviews WHERE team_id=? AND month=? AND source_hash=? AND status IN ('awaiting_owner','approved') ORDER BY created_at DESC LIMIT 1").get(scope.team_id, month, hash);
      if (old) return old;
      const result = previewSettlement(scope.team_id, month);
      const id = randomBytes(6).toString('hex');
      const money = n => Number(n || 0).toFixed(2);
      const message = [`【月度财务审核】${team.name} · ${month}`, `审核单 ${id}`,
        `总收入 ¥${money(result.total_income)}；总支出 ¥${money(result.total_expense)}`,
        ...(result.expense_items || []).map(item => `支出：${item.item_name || '未命名'} ¥${money(item.amount)}，垫付：${item.payer_name || '待核对'}，备注：${item.note || '无'}`),
        ...(result.members || []).map(m => `${m.name}：净分成 ${m.net_share == null ? '未拆分' : '¥'+money(m.net_share)}；垫付 ¥${money(m.paid_expense)}；应收 ¥${money(m.should_get)}；已收 ¥${money(m.actual)}`),
        ...(result.transfers || []).map(t => `${t.from} → ${t.to}：¥${money(t.amount)}`)].join('\n');
      db.prepare('INSERT INTO finance_reviews VALUES (?,?,?,?,?,?,?,?,?)').run(id, scope.team_id, month, hash, JSON.stringify(result), message, 'awaiting_owner', stamp(), stamp());
      queue({id,account_id:scope.account_id,recipient_id:scope.owner_id}, `${message}\n\n请核对后回复“确认发布 ${id}”；有误回复“拒绝 ${id}”。确认前不会发群。`, 'owner-review');
      return db.prepare('SELECT * FROM finance_reviews WHERE id=?').get(id);
    }).immediate();
  }
  function ownerReply(event) {
    const key = `${event.account_id}:owner:${event.message_id}`;
    if (db.prepare('SELECT 1 FROM finance_message_events WHERE event_key=?').get(key)) return;
    const match = clean(event.content, 500).match(/^(确认发布|同意发布|拒绝)\s+([a-f0-9]{12})[。！!\s]*$/);
    if (!match) return;
    db.transaction(() => {
      const scope = getScope(), review = db.prepare('SELECT * FROM finance_reviews WHERE id=?').get(match[2]);
      if (!review || review.status !== 'awaiting_owner' || review.team_id !== scope.team_id) return;
      let reply;
      if (match[1] === '拒绝') {
        db.prepare("UPDATE finance_reviews SET status='rejected',updated_at=? WHERE id=?").run(stamp(), review.id);
        reply = `审核单 ${review.id} 已拒绝，没有发布到群。`;
      } else if (sourceHash(review.team_id, review.month) !== review.source_hash) {
        db.prepare("UPDATE finance_reviews SET status='stale',updated_at=? WHERE id=?").run(stamp(), review.id);
        reply = '审核期间原始数据或规则已变化，请重新生成审核单；没有发群。';
      } else {
        if (!publishSettlement) throw new HttpError(503, '结算发布服务尚未就绪');
        publishSettlement(review.team_id, review.month);
        db.prepare("UPDATE finance_reviews SET status='approved',updated_at=? WHERE id=?").run(stamp(), review.id);
        queue({id:review.id,account_id:scope.account_id,sender_id:''}, `${review.message}\n主人审核已通过。`, 'approved-group');
        reply = `审核单 ${review.id} 已通过，结算已保存，群发布任务已排队。`;
      }
      queue({id:review.id,account_id:scope.account_id,recipient_id:scope.owner_id},reply,`owner-${event.message_id}`);
      db.prepare('INSERT INTO finance_message_events VALUES (?,?,?)').run(key, reply, stamp());
    }).immediate();
  }
  function list() {
    return db.prepare(`SELECT s.id,s.event_key,s.account_id,s.group_id,s.sender_id,s.team_id,s.user_id,s.status,s.image_hash,s.mime_type,
      s.extraction_json,s.month,s.source_month,s.selected_json,s.record_ids_json,s.question,s.audit_json,s.created_at,s.updated_at,
      (length(s.image_data)>0) AS has_image,u.name AS member_name
      FROM finance_submissions s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT 100`).all().map(publicRow);
  }
  return { getScope, configure, bind, get: id => publicRow(get(id)), image: id => get(id), submit, process, confirm, cancel, exchange, list, requestReview,
    reviews: () => db.prepare('SELECT id,team_id,month,status,created_at,updated_at FROM finance_reviews ORDER BY created_at DESC LIMIT 30').all(),
    resume: () => db.prepare("SELECT id FROM finance_submissions WHERE status='processing'").all().forEach(r => setImmediate(() => process(r.id).catch(onError))),
    bindings: () => db.prepare('SELECT b.*,u.name AS member_name FROM finance_bindings b JOIN users u ON u.id=b.user_id ORDER BY b.updated_at DESC').all() };
}
module.exports = { createFinanceAgent, imageType, cents, GROUP_ID };
