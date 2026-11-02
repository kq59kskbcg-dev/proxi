// The timeline shown on a reply: what Proxi did, as short and full text with an icon.

// Timeline entries on a reply: a short form for the summary line, a full one for the list.
// Icons for timeline steps: what was done, or which tool ran.
const STEP_ICONS = {
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"></path>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"></path><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"></path>',
  globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"></path>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"></path>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path>'
};
const TOOL_ICONS = { search_docs: 'book', web_search: 'globe', get_status: 'pulse' };
export function toStep(a) {
  return { short: a.done, text: a.detail || a.done, icon: a.icon || TOOL_ICONS[a.tool] || 'tool' };
}
export function stepIcon(name) {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (STEP_ICONS[name] || STEP_ICONS.tool) + '</svg>';
}

const REDACTED_NAMES = { CARD: ['card number', 'card numbers'], IBAN: ['IBAN', 'IBANs'], EMAIL: ['email address', 'email addresses'], PHONE: ['phone number', 'phone numbers'] };
export function redactionSteps(counts) {
  const parts = Object.entries(counts || {}).filter(([, n]) => n > 0)
    .map(([k, n]) => n + ' ' + (REDACTED_NAMES[k] ? REDACTED_NAMES[k][n === 1 ? 0 : 1] : k));
  if (!parts.length) return [];
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
  return [{ done: 'Redacted personal data', detail: 'Removed ' + list + ' before sending', icon: 'shield' }];
}

// Shown while waiting for a reply, until the agent reports a real step.
export const WORKING_VERBS = ['Thinking', 'Pondering', 'Connecting the dots', 'Weighing it up', 'Choosing words', 'Drafting'];
