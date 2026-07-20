/**
 * 导入 2025 年历史收入数据（用于去年同月对比）
 * 运行方式：node scripts/import-2025.js
 * 如需指定团队ID：node scripts/import-2025.js --team-id=2
 * 数据来源：scripts/data/income.local.json 的 y2025 字段（原始来源：历史记账表）
 * 数据文件含真实姓名与收入，属于本地隐私文件，已在 .gitignore 中，不会被提交；
 * 格式参考 scripts/data/income.example.json
 */

const fs = require('fs');
const path = require('path');
const { db } = require('../src/config/database');

const DATA_FILE = path.join(__dirname, 'data', 'income.local.json');

// 格式：{ month, records: [{ name, amount, itemType?, itemName? }] }
// amount 单位：元（脚本内部统一乘以100转为分再写入）
function loadHistory() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`❌ 未找到数据文件：${DATA_FILE}`);
    console.error('   该文件包含真实收入数据，属于本地隐私文件（已在 .gitignore 中，不随仓库分发）。');
    console.error('   请从数据保管人处获取 income.local.json 并放到 scripts/data/ 目录，');
    console.error('   或参照 scripts/data/income.example.json 的格式自行填写。');
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error(`❌ 数据文件 JSON 解析失败：${DATA_FILE}\n   ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed.y2025)) {
    console.error(`❌ 数据文件缺少 y2025 数组字段：${DATA_FILE}（格式参考 income.example.json）`);
    process.exit(1);
  }
  return parsed.y2025;
}

const HISTORY = loadHistory();

// ─── 解析 --team-id 参数 ───────────────────────────────────────────
function getTeamId() {
  const arg = process.argv.find(a => a.startsWith('--team-id='));
  if (arg) return Number(arg.split('=')[1]);
  // 自动找第一个团队
  const row = db.prepare('SELECT id, name FROM teams ORDER BY id LIMIT 1').get();
  if (!row) { console.error('❌ 数据库中没有团队，请先创建团队'); process.exit(1); }
  return row.id;
}

function toCents(yuan) {
  return Math.round(parseFloat(yuan) * 100);
}

function main() {
  const teamId = getTeamId();
  const teamRow = db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId);
  console.log(`\n导入目标团队：${teamRow ? teamRow.name : '?'} (id=${teamId})`);

  let inserted = 0, skipped = 0;

  const insert = db.prepare(`
    INSERT INTO income_records (team_id, month, person_name, item_type, item_name, amount, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const checkExist = db.prepare(`
    SELECT COUNT(*) AS cnt FROM income_records
    WHERE team_id = ? AND month = ? AND note = '2025历史导入'
  `);

  db.transaction(() => {
    for (const { month, records } of HISTORY) {
      const already = checkExist.get(teamId, month).cnt;
      if (already > 0) {
        console.log(`  ⏭  ${month} 已有历史导入数据，跳过`);
        skipped += records.length;
        continue;
      }

      let monthTotal = 0;
      for (const r of records) {
        const itemType = r.itemType || 'income';
        const itemName = r.itemName || '京东收益';
        const amountCents = toCents(Math.abs(r.amount));
        // expense 类型存正数（结算引擎用 Math.abs）
        insert.run(teamId, month, r.name, itemType, itemName, amountCents, '2025历史导入');
        if (itemType === 'income') monthTotal += r.amount;
        inserted++;
      }
      console.log(`  ✅ ${month}  共 ${records.length} 条  总收入 ¥${monthTotal.toFixed(2)}`);
    }
  })();

  console.log(`\n完成：新增 ${inserted} 条，跳过 ${skipped} 条\n`);
}

main();
