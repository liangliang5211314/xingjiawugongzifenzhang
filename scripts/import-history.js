/**
 * 导入 2023、2024 年历史收入数据（用于年同比对比）
 * 运行方式：node scripts/import-history.js
 * 如需指定团队ID：node scripts/import-history.js --team-id=2
 *
 * 数据来源：Z团队收入表.xlsx（Z2024、Z2023年 两个 Sheet）
 * 导入：崔紫阳、崔海亮、崔如意（原崔小易）、某宝 以及其他外部京粉账号（小达/张凯风）的实际到账金额
 * 外部账号以 person_name='其他账号' 记录；不参与结算分配，但计入团队总收入
 */

const { db } = require('../src/config/database');

const HISTORY = [
  // ─── 2024 年 ─────────────────────────────────────────────────────
  {
    month: '2024-01',
    records: [
      { name: '崔紫阳', amount: 16807.19 },
      { name: '崔海亮', amount:  4339.16 },
      { name: '崔如意', amount: 11087.04 },
    ],
  },
  {
    month: '2024-02',
    records: [
      { name: '崔紫阳', amount: 17381.73 },
      { name: '崔海亮', amount:  4257.78 },
      { name: '崔如意', amount: 10469.72 },
    ],
  },
  {
    month: '2024-03',
    records: [
      // 第一批（常规）
      { name: '崔紫阳', amount: 10987.56, itemName: '京东收益（3月第一批）' },
      { name: '崔海亮', amount:  3518.06, itemName: '京东收益（3月第一批）' },
      { name: '崔如意', amount:  7352.79, itemName: '京东收益（3月第一批）' },
      // 第二批
      { name: '崔紫阳', amount:  9036.51, itemName: '京东收益（3月第二批）' },
      { name: '崔海亮', amount: 13786.87, itemName: '京东收益（3月第二批）' },
      { name: '崔如意', amount:  9306.44, itemName: '京东收益（3月第二批）' },
      { name: '其他账号', amount: 1620.42, itemName: '其他京粉账号收益' },
    ],
  },
  {
    month: '2024-04',
    records: [
      { name: '崔紫阳', amount: 11034.18 },
      { name: '崔海亮', amount:  3189.72 },
      { name: '崔如意', amount:  6368.75 },
      { name: '某宝',   amount:   654.07, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2024-05',
    records: [
      { name: '崔紫阳', amount: 10223.99 },
      { name: '崔海亮', amount:  3060.90 },
      { name: '崔如意', amount:  6076.99 },
    ],
  },
  {
    month: '2024-06',
    records: [
      { name: '崔紫阳', amount: 12011.30 },
      { name: '崔海亮', amount:  2487.50 },
      { name: '崔如意', amount:  8477.82 },
      { name: '某宝',   amount:  1196.63, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2024-07',
    records: [
      { name: '崔紫阳', amount: 15799.97 },
      { name: '崔海亮', amount:  3561.86 },
      { name: '崔如意', amount: 18796.83 },
      { name: '某宝',   amount:  1637.50, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2024-08',
    records: [
      { name: '崔紫阳', amount:  7342.93 },
      { name: '崔海亮', amount:  2026.76 },
      { name: '崔如意', amount:  8469.36 },
      { name: '某宝',   amount:   784.00, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2024-09',
    records: [
      { name: '崔紫阳', amount:  6001.17 },
      { name: '崔海亮', amount:  1677.00 },
      { name: '崔如意', amount:  7469.00 },
      { name: '某宝',   amount:   873.00, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2024-10',
    records: [
      { name: '崔紫阳', amount:  7155.49 },
      { name: '崔海亮', amount:  2177.91 },
      { name: '崔如意', amount:  8316.81 },
      { name: '某宝',   amount:   846.66, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2024-11',
    records: [
      { name: '崔紫阳', amount:  1492.30 },
      { name: '崔海亮', amount: 12620.16 },
      { name: '崔如意', amount: 13236.23 },
      { name: '某宝',   amount:  1387.41, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2024-12',
    records: [
      { name: '崔紫阳', amount:  3996.96 },
      { name: '崔海亮', amount: 14696.73 },
      { name: '崔如意', amount: 16460.22 },
      { name: '某宝',   amount:  1513.67, itemName: '淘宝收益' },
    ],
  },

  // ─── 2023 年 ─────────────────────────────────────────────────────
  {
    month: '2023-01',
    records: [
      { name: '崔紫阳', amount:  5402.62 },
      { name: '崔海亮', amount: 10757.66 },
      { name: '崔如意', amount:  7589.15 },
      { name: '某宝',   amount:  2534.19, itemName: '淘宝收益' },
      { name: '其他账号', amount: 14380.60, itemName: '其他京粉账号收益（小达）' },
    ],
  },
  {
    month: '2023-02',
    records: [
      { name: '崔紫阳', amount:   856.05 },
      { name: '崔海亮', amount: 27284.55 },
      { name: '崔如意', amount:  1099.37 },
      { name: '某宝',   amount:  1984.00, itemName: '淘宝收益' },
      { name: '其他账号', amount:  1266.64, itemName: '其他京粉账号收益（小达）' },
    ],
  },
  {
    month: '2023-03',
    records: [
      // 常规批次
      { name: '崔紫阳',  amount:    24.25, itemName: '京东收益（3月常规）' },
      { name: '崔海亮',  amount: 14980.65, itemName: '京东收益（3月常规）' },
      { name: '崔如意',  amount:    85.14, itemName: '京东收益（3月常规）' },
      { name: '某宝',    amount:  1080.46, itemName: '淘宝收益' },
      { name: '其他账号', amount:    72.80, itemName: '其他京粉账号收益' },
      // 退税批次
      { name: '崔紫阳',  amount: 10538.00, itemName: '京东收益（3月退税）' },
      { name: '崔海亮',  amount:  6609.00, itemName: '京东收益（3月退税）' },
      { name: '崔如意',  amount: 15642.00, itemName: '京东收益（3月退税）' },
      { name: '其他账号', amount:  8807.00, itemName: '其他京粉账号收益（小达）退税' },
      { name: '其他账号', amount:  7078.00, itemName: '其他京粉账号收益（张凯风）退税' },
    ],
  },
  {
    month: '2023-04',
    records: [
      { name: '崔紫阳',  amount:     9.87 },
      { name: '崔海亮',  amount: 14657.18 },
      { name: '崔如意',  amount:    92.36 },
      { name: '某宝',    amount:   938.74, itemName: '淘宝收益' },
      { name: '其他账号', amount:    33.04, itemName: '其他京粉账号收益' },
    ],
  },
  {
    month: '2023-05',
    records: [
      { name: '崔紫阳',  amount:     5.61 },
      { name: '崔海亮',  amount: 14006.61 },
      { name: '崔如意',  amount:    14.61 },
      { name: '某宝',    amount:  1095.15, itemName: '淘宝收益' },
      { name: '其他账号', amount:     6.31, itemName: '其他京粉账号收益' },
    ],
  },
  {
    month: '2023-06',
    records: [
      { name: '崔紫阳',  amount:  1602.44 },
      { name: '崔海亮',  amount: 12744.53 },
      { name: '崔如意',  amount:  2098.82 },
      { name: '某宝',    amount:  1160.32, itemName: '淘宝收益' },
      { name: '其他账号', amount:    62.82, itemName: '其他京粉账号收益' },
    ],
  },
  {
    month: '2023-07',
    records: [
      { name: '崔紫阳',  amount: 15559.39 },
      { name: '崔海亮',  amount: 10194.69 },
      { name: '崔如意',  amount: 19558.18 },
      { name: '某宝',    amount:  1723.76, itemName: '淘宝收益' },
      { name: '其他账号', amount:    24.72, itemName: '其他京粉账号收益' },
    ],
  },
  {
    month: '2023-08',
    records: [
      { name: '崔紫阳', amount:  8206.00 },
      { name: '崔海亮', amount:  7008.54 },
      { name: '崔如意', amount:  7693.69 },
      { name: '某宝',   amount:   961.75, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2023-09',
    records: [
      { name: '崔紫阳', amount:  6845.87 },
      { name: '崔海亮', amount:  7909.58 },
      { name: '崔如意', amount:  7602.90 },
      { name: '某宝',   amount:   751.09, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2023-10',
    records: [
      { name: '崔紫阳', amount:  9041.64 },
      { name: '崔海亮', amount: 10349.05 },
      { name: '崔如意', amount:  8323.34 },
      { name: '某宝',   amount:   851.40, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2023-11',
    records: [
      { name: '崔紫阳', amount: 14882.03 },
      { name: '崔海亮', amount:  5271.32 },
      { name: '崔如意', amount: 14819.51 },
      { name: '某宝',   amount:   704.54, itemName: '淘宝收益' },
    ],
  },
  {
    month: '2023-12',
    records: [
      { name: '崔紫阳', amount: 34156.57 },
      { name: '崔海亮', amount:  5813.23 },
      { name: '崔如意', amount: 25345.03 },
      { name: '某宝',   amount:  3095.60, itemName: '淘宝收益' },
    ],
  },
];

function getTeamId() {
  const arg = process.argv.find(a => a.startsWith('--team-id='));
  if (arg) return Number(arg.split('=')[1]);
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
    WHERE team_id = ? AND month = ? AND note LIKE '%历史导入'
  `);

  db.transaction(() => {
    for (const { month, records } of HISTORY) {
      const already = checkExist.get(teamId, month).cnt;
      if (already > 0) {
        console.log(`  ⏭  ${month} 已有历史导入数据，跳过`);
        skipped += records.length;
        continue;
      }

      const year = month.slice(0, 4);
      const noteTag = `${year}历史导入`;
      let monthTotal = 0;
      for (const r of records) {
        const itemName = r.itemName || '京东收益';
        const amountCents = toCents(r.amount);
        insert.run(teamId, month, r.name, 'income', itemName, amountCents, noteTag);
        monthTotal += r.amount;
        inserted++;
      }
      console.log(`  ✅ ${month}  共 ${records.length} 条  总收入 ¥${monthTotal.toFixed(2)}`);
    }
  })();

  console.log(`\n完成：新增 ${inserted} 条，跳过 ${skipped} 条\n`);
}

main();
