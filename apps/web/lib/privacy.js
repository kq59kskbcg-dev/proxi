// The privacy page's numbers: what was redacted from a user's messages, this month and all time.

// The types redact() can find, in a fixed order so every type shows, even at zero.
export const REDACTION_TYPES = ['EMAIL', 'PHONE', 'CARD', 'IBAN'];
// The all-time chart shows at most this many months, the latest last.
const MAX_MONTHS = 6;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// rows: { day: 'YYYY-MM-DD', type, count }, with days of the current month as they are and
// earlier days grouped on the first of their month (see getRedactionCounts).
export function summarizeRedactions({ rows, since, today }) {
  const month = today.slice(0, 7);
  const empty = () => Object.fromEntries(REDACTION_TYPES.map((t) => [t, 0]));
  const thisMonth = { total: 0, byType: empty() };
  const allTime = { total: 0, byType: empty() };
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const weeks = Array.from({ length: Math.ceil(daysInMonth / 7) }, (_, i) => ({ label: `Wk ${i + 1}`, count: 0 }));
  const perMonth = new Map();

  for (const { day, type, count } of rows) {
    allTime.total += count;
    allTime.byType[type] = (allTime.byType[type] || 0) + count;
    const key = day.slice(0, 7);
    perMonth.set(key, (perMonth.get(key) || 0) + count);
    if (key === month) {
      thisMonth.total += count;
      thisMonth.byType[type] = (thisMonth.byType[type] || 0) + count;
      weeks[Math.ceil(Number(day.slice(8, 10)) / 7) - 1].count += count;
    }
  }

  // Months from the first one counted (or this one) up to this one, the most recent MAX_MONTHS.
  const months = [];
  const start = since ? since.slice(0, 7) : month;
  for (let y = year, m = mon; months.length < MAX_MONTHS; m--) {
    if (m === 0) { m = 12; y--; }
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key < start) break;
    months.unshift({ label: MONTH_NAMES[m - 1], count: perMonth.get(key) || 0 });
  }

  return {
    since,
    today,
    month: { ...thisMonth, bars: weeks },
    all: { ...allTime, bars: months },
  };
}
