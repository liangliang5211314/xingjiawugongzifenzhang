/**
 * 将数据库中所有 崔小易 重命名为 崔如意
 * 同时清空受影响月份的结算快照（需重新结算以更新 result_json）
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbPath);

const OLD_NAME = '崔小易';
const NEW_NAME = '崔如意';

db.transaction(() => {
  // 1. income_records
  const r1 = db.prepare("UPDATE income_records SET person_name = ? WHERE person_name = ?").run(NEW_NAME, OLD_NAME);
  console.log(`income_records 更新 ${r1.changes} 行`);

  // 2. team_rule_members（如有）
  try {
    const r2 = db.prepare("UPDATE team_rule_members SET member_name = ? WHERE member_name = ?").run(NEW_NAME, OLD_NAME);
    console.log(`team_rule_members 更新 ${r2.changes} 行`);
  } catch (e) {
    console.log('team_rule_members 表不存在，跳过');
  }

  // 3. 清空含有该成员的结算快照（result_json 中有旧名字，需重新结算）
  const settlements = db.prepare("SELECT id, month, result_json FROM settlements").all();
  let cleared = 0;
  for (const s of settlements) {
    if (s.result_json && s.result_json.includes(OLD_NAME)) {
      db.prepare("DELETE FROM settlements WHERE id = ?").run(s.id);
      console.log(`  删除结算快照 id=${s.id} month=${s.month}（含旧名字）`);
      cleared++;
    }
  }
  console.log(`共清理结算快照 ${cleared} 条，请在管理后台重新运行结算`);
})();

console.log('✅ 完成');
