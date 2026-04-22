/**
 * 导入 2025 年历史收入数据（用于去年同月对比）
 * 运行方式：node scripts/import-2025.js
 * 如需指定团队ID：node scripts/import-2025.js --team-id=2
 */

const { db } = require('../src/config/database');

// ─── 2025 年各月数据（来源：历史记账表）────────────────────────────
// 格式：{ month, records: [{ name, amount, itemType?, itemName? }] }
// amount 单位：元（脚本内部统一乘以100转为分再写入）
const HISTORY = [
  {
    month: '2025-01',
    records: [
      { name: '崔紫阳', amount: 5335.07 },
      { name: '崔海亮', amount: 5737.81 },
      { name: '崔小易', amount: 8989.19 },
    ],
  },
  {
    month: '2025-02',
    records: [
      { name: '崔紫阳', amount: 4400.60 },
      { name: '崔海亮', amount: 6423.88 },
      { name: '崔小易', amount: 10413.06 },
      { name: '某宝',   amount: 412.89,  itemName: '淘宝收益' },
    ],
  },
  {
    month: '2025-03',
    records: [
      // 第一批（常规）
      { name: '崔紫阳', amount: 2031.48,  itemName: '京东收益（3月第一批）' },
      { name: '崔海亮', amount: 2701.83,  itemName: '京东收益（3月第一批）' },
      { name: '崔小易', amount: 4593.00,  itemName: '京东收益（3月第一批）' },
      // 第二批（报税批次）
      { name: '崔紫阳', amount: 10564.64, itemName: '京东收益（3月报税）' },
      { name: '崔海亮', amount: 4444.07,  itemName: '京东收益（3月报税）' },
      { name: '崔小易', amount: 11705.12, itemName: '京东收益（3月报税）' },
    ],
  },
  {
    month: '2025-04',
    records: [
      { name: '崔紫阳', amount: 2706.72 },
      { name: '崔海亮', amount: 3741.26 },
      { name: '崔小易', amount: 6293.04 },
    ],
  },
  {
    month: '2025-05',
    records: [
      { name: '崔紫阳', amount: 2530.17 },
      { name: '崔海亮', amount: 3014.82 },
      { name: '崔小易', amount: 4868.36 },
      { name: '某宝',   amount: 204.15,  itemName: '淘宝收益' },
    ],
  },
  {
    month: '2025-06',
    records: [
      { name: '崔紫阳', amount: 2886.06 },
      { name: '崔海亮', amount: 4051.96 },
      { name: '崔小易', amount: 6182.21 },
    ],
  },
  {
    month: '2025-07',
    records: [
      { name: '崔紫阳', amount: 5507.20 },
      { name: '崔海亮', amount: 5278.38 },
      { name: '崔小易', amount: 7827.37 },
    ],
  },
  {
    month: '2025-08',
    records: [
      { name: '崔紫阳', amount: 2915.59 },
      { name: '崔海亮', amount: 3090.26 },
      { name: '崔小易', amount: 4960.92 },
      { name: '某宝',   amount: 355.72,  itemName: '淘宝收益' },
    ],
  },
  {
    month: '2025-09',
    records: [
      { name: '崔紫阳', amount: 2090.22 },
      { name: '崔海亮', amount: 2743.77 },
      { name: '崔小易', amount: 3946.24 },
      { name: '某宝',   amount: 338.49,  itemName: '淘宝收益' },
    ],
  },
  {
    month: '2025-10',
    records: [
      { name: '崔紫阳', amount: 2734.90 },
      { name: '崔海亮', amount: 4155.70 },
      { name: '崔小易', amount: 6115.62 },
    ],
  },
  {
    month: '2025-11',
    records: [
      { name: '崔紫阳', amount: 6131.51 },
      { name: '崔海亮', amount: 6252.85 },
      { name: '崔小易', amount: 9254.58 },
    ],
  },
  {
    month: '2025-12',
    records: [
      { name: '崔紫阳', amount: 6622.98 },
      { name: '崔海亮', amount: 6744.96 },
      { name: '崔小易', amount: 9812.69 },
      { name: '某宝',   amount: -2093.00, itemType: 'expense', itemName: '淘宝退款/扣款' },
    ],
  },
];

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
