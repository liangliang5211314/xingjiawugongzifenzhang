const { db } = require('../config/database');

function createPushLog({ settlement_id, user_id, openid, push_type, request_json, response_json, status }) {
  const info = db.prepare(`
    INSERT INTO push_logs (settlement_id, user_id, openid, push_type, request_json, response_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    settlement_id || null, user_id || null, openid || null,
    push_type || 'wechat_template',
    request_json ? JSON.stringify(request_json) : null,
    response_json ? JSON.stringify(response_json) : null,
    status || 'pending'
  );
  return db.prepare('SELECT * FROM push_logs WHERE id = ?').get(info.lastInsertRowid);
}

function listPushLogs({ settlementId, limit = 100 } = {}) {
  let sql = `
    SELECT pl.*, u.name AS user_name
    FROM push_logs pl
    LEFT JOIN users u ON u.id = pl.user_id
    WHERE 1=1
  `;
  const params = [];
  if (settlementId) { sql += ' AND pl.settlement_id = ?'; params.push(settlementId); }
  sql += ' ORDER BY pl.created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

module.exports = { createPushLog, listPushLogs };
