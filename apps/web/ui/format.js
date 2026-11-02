// Pure helpers for text, dates and names shown in the page.

// Splits a chat title into parts, marking where the search text appears.
export function highlight(title, q) {
  if (!q) return [{ text: title, hit: false }];
  const parts = [];
  const lower = title.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, at)) {
    if (i > at) parts.push({ text: title.slice(at, i), hit: false });
    parts.push({ text: title.slice(i, i + q.length), hit: true });
    at = i + q.length;
  }
  if (at < title.length) parts.push({ text: title.slice(at), hit: false });
  return parts;
}

// "Today", "Yesterday" or a short date like "Oct 12", from when a chat was last used.
export function whenLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Heading for a chat in the search list: Today, Yesterday, Previous 7 days, then the month.
export function groupOf(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return 'Earlier';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7) return 'Previous 7 days';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

// Full date and time, shown when hovering a search result.
export function fullDate(iso) {
  const d = new Date(iso);
  return !iso || isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function shareUrl(shareId) {
  return location.origin + '/s/' + shareId;
}

export function maskCards(text) {
  return text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
    const digits = match.replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return sum % 10 === 0 ? '•••• •••• •••• ' + digits.slice(-4) : match;
  });
}

const MODEL_LABELS = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };
export function modelLabel(id) {
  return MODEL_LABELS[id] || id;
}
