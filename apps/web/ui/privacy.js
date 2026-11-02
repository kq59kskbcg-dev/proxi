// The privacy page: turns the summary from /api/privacy into what the page shows.

const TYPE_NAMES = { EMAIL: ['email', 'emails'], PHONE: ['phone number', 'phone numbers'], CARD: ['card number', 'card numbers'], IBAN: ['IBAN', 'IBANs'] };
const BAR_MAX = 80; // px, the tallest bar in the chart

const plural = (type) => (TYPE_NAMES[type] || [type, type])[1];
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The line under the headline: what happened, then the two most common types.
export function summaryLine(total, byType, period) {
  if (!total) return period === 'month' ? 'Nothing removed this month.' : '';
  if (total === 1) return 'Proxi removed it from your message before sending it to Claude.';
  const top = Object.entries(byType).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([t]) => plural(t));
  const mostly = top.length === 1 ? `All of them were ${top[0]}.` : `Mostly ${top[0]} and ${top[1]}.`;
  return `Proxi removed them from your messages before sending them to Claude. ${mostly}`;
}

export function privacyView(summary, period) {
  const part = summary[period];
  const max = Math.max(0, ...Object.values(part.byType));
  const barMax = Math.max(0, ...part.bars.map((b) => b.count));
  const types = Object.entries(part.byType)
    .map(([type, n], i) => ({ type, n, i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(({ type, n }) => ({ key: type, label: capital(plural(type)), n, width: max ? Math.round((n / max) * 100) + '%' : '0%' }));
  const bars = part.bars.map((b) => ({ key: b.label, label: b.label, n: b.count, height: (barMax ? Math.max(2, Math.round((b.count / barMax) * BAR_MAX)) : 2) + 'px' }));
  return {
    empty: summary.all.total === 0,
    count: `${part.total.toLocaleString('en-US')} personal ${part.total === 1 ? 'detail' : 'details'}`,
    when: period === 'month' ? 'protected this month' : 'protected',
    line: summaryLine(part.total, part.byType, period),
    types,
    chartTitle: period === 'month' ? 'Each week' : 'Each month',
    chartLabel: (period === 'month' ? 'Details removed each week this month: ' : 'Details removed each month: ') + bars.map((b) => `${b.label} ${b.n}`).join(', '),
    bars,
    columns: `repeat(${bars.length}, minmax(0, 1fr))`,
  };
}
