// 本地时区月份工具（不要用 toISOString，它是 UTC，北京时间每月 1 日早 8 点前会错月）

// 当前月份 YYYY-MM（本地时区）
function currentMonth(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// 上一个月 YYYY-MM（按年月算术，避免 setMonth 在 31 号溢出）
function prevMonth(monthStr = currentMonth()) {
  let [y, m] = monthStr.split('-').map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

module.exports = { currentMonth, prevMonth };
