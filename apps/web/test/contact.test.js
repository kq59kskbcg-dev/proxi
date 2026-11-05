import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMAIL, contactSummary, contactField, contactOffer, contactLimit } from '../lib/contact.js';
import { parseChatRequest, contactOf } from '../lib/chat-request.js';

test('the page checks addresses with the same pattern as the server and the MCP server', () => {
  const page = readFileSync(new URL('../ui/chat.js', import.meta.url), 'utf8');
  const mcp = readFileSync(new URL('../../mcp/lib/resend.js', import.meta.url), 'utf8');
  assert.ok(page.includes(`/${EMAIL.source}/`), 'ui/chat.js CONTACT_EMAIL matches lib/contact.js EMAIL');
  assert.ok(mcp.includes(`/${EMAIL.source}/`), 'apps/mcp/lib/resend.js EMAIL matches lib/contact.js EMAIL');
});

test('summaries are tidied and redacted, and empty or long ones are refused', () => {
  assert.equal(contactSummary('  Help   with a link.\n\n\n\nCall +31 6 12345678 '), 'Help with a link.\n\nCall [PHONE]');
  assert.equal(contactSummary(''), null);
  assert.equal(contactSummary('x'.repeat(601)), null);
  assert.equal(contactSummary(42), null);
  assert.deepEqual(contactField({ summary: 'Help', sent: 'yes', extra: 1 }), { summary: 'Help', sent: false });
  assert.equal(contactField('Help'), null);
});

test('the model can show one card per reply', () => {
  const shown = [];
  const offer = contactOffer((s) => shown.push(s));
  assert.equal(offer.run({ id: 't1', input: { summary: '' } }).is_error, true);
  assert.equal(offer.run({ id: 't2', input: { summary: 'Their link broke.' } }).is_error, false);
  assert.equal(offer.run({ id: 't3', input: { summary: 'Again.' } }).is_error, true);
  assert.deepEqual(shown, ['Their link broke.']);
  assert.equal(offer.shown(), 'Their link broke.');
});

test('Send is limited per user', () => {
  const results = Array.from({ length: 4 }, () => contactLimit('user_limit').ok);
  assert.deepEqual(results, [true, true, true, false]);
  assert.equal(contactLimit('someone_else').ok, true);
});

test('chat requests keep a reply\'s card and the escalated flag, and a card-only reply is valid', () => {
  const parsed = parseChatRequest({ model: 'Auto', escalated: true, messages: [
    { role: 'user', content: 'Can I talk to a person?' },
    { role: 'assistant', content: '', contact: { summary: 'Their link broke.', sent: true } },
    { role: 'user', content: 'Thanks' },
  ] });
  assert.equal(parsed.escalated, true);
  assert.deepEqual(contactOf(parsed.messages[1]), { summary: 'Their link broke.', sent: true });
  assert.equal(contactOf({ role: 'user', contact: { summary: 'x' } }), null);
  assert.equal(parseChatRequest({ model: 'Auto', messages: [{ role: 'user', content: 'Hi' }] }).escalated, false);
});

test('a skipped card keeps its flag, unless it was sent', () => {
  assert.deepEqual(contactField({ summary: 'Help', sent: false, skipped: true }), { summary: 'Help', sent: false, skipped: true });
  assert.deepEqual(contactField({ summary: 'Help', sent: true, skipped: true }), { summary: 'Help', sent: true });
  assert.deepEqual(contactField({ summary: 'Help', skipped: 'yes' }), { summary: 'Help', sent: false });
  const parsed = parseChatRequest({ model: 'Auto', messages: [
    { role: 'user', content: 'Can I talk to a person?' },
    { role: 'assistant', content: '', contact: { summary: 'Their link broke.', sent: false, skipped: true } },
    { role: 'user', content: 'Never mind' },
  ] });
  assert.deepEqual(contactOf(parsed.messages[1]), { summary: 'Their link broke.', sent: false, skipped: true });
});
