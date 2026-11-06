import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlight, groupOf, whenLabel, fullDate, shareUrl, maskCards, modelLabel } from '../ui/format.js';
import { redactionSteps, toStep, stepIcon } from '../ui/steps.js';
import { classify, formatSize, ACCEPT } from '../ui/files.js';
import { opensAbove, chatLinkId } from '../ui/citations.js';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

test('highlight splits a title around the search text', () => {
  assert.deepEqual(highlight('Hello world', ''), [{ text: 'Hello world', hit: false }]);
  assert.deepEqual(highlight('a cat and a cat', 'cat'), [
    { text: 'a ', hit: false }, { text: 'cat', hit: true }, { text: ' and a ', hit: false }, { text: 'cat', hit: true },
  ]);
});

test('chat dates are grouped and labelled', () => {
  assert.equal(whenLabel(''), '');
  assert.equal(whenLabel(new Date().toISOString()), 'Today');
  assert.equal(groupOf(daysAgo(0)), 'Today');
  assert.equal(groupOf(daysAgo(1)), 'Yesterday');
  assert.equal(groupOf(daysAgo(5)), 'Previous 7 days');
  assert.equal(groupOf('nonsense'), 'Earlier');
  assert.equal(fullDate(''), '');
  assert.notEqual(fullDate(daysAgo(2)), '');
});

test('shareUrl builds the public link from the page origin', () => {
  globalThis.location = { origin: 'https://example.test' };
  assert.equal(shareUrl('abc'), 'https://example.test/s/abc');
});

test('maskCards hides valid card numbers and leaves other numbers alone', () => {
  assert.equal(maskCards('pay 4111 1111 1111 1111 now'), 'pay •••• •••• •••• 1111 now');
  assert.equal(maskCards('order 1234567890123'), 'order 1234567890123');
});

test('modelLabel shows a friendly name and passes unknown ids through', () => {
  assert.equal(modelLabel('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(modelLabel('other'), 'other');
});

test('redactionSteps lists what was removed, with plurals', () => {
  assert.deepEqual(redactionSteps({}), []);
  assert.deepEqual(redactionSteps({ EMAIL: 1 }), [{ done: 'Redacted personal data', detail: 'Removed 1 email address before sending', icon: 'shield' }]);
  assert.equal(redactionSteps({ EMAIL: 2, CARD: 1, IBAN: 0 })[0].detail, 'Removed 2 email addresses and 1 card number before sending');
});

test('timeline steps get an icon from the step or the tool', () => {
  assert.deepEqual(toStep({ done: 'Searched', detail: 'Searched the help center', tool: 'search_docs' }), { short: 'Searched', text: 'Searched the help center', icon: 'book' });
  assert.equal(toStep({ done: 'x', tool: 'unknown' }).icon, 'tool');
  assert.match(stepIcon('nope'), /^<svg .*<\/svg>$/);
});

test('classify sorts files into image, pdf, text or unsupported', () => {
  assert.equal(classify({ type: 'image/png', name: 'a.png' }), 'image');
  assert.equal(classify({ type: '', name: 'a.PDF' }), 'pdf');
  assert.equal(classify({ type: '', name: 'notes.md' }), 'text');
  assert.equal(classify({ type: 'application/zip', name: 'a.zip' }), null);
  assert.match(ACCEPT, /image\/png/);
});

test('formatSize uses B, KB and MB', () => {
  assert.equal(formatSize(500), '500 B');
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(3 * 1048576), '3.0 MB');
});

test('the sources card opens above the button only when it fits better there', () => {
  assert.equal(opensAbove(400, 100, 220), false);
  assert.equal(opensAbove(120, 500, 220), true);
  assert.equal(opensAbove(120, 80, 220), false);
});

test('a source is one of the user\'s chats only when it links to /?chat=<id> on this site', () => {
  const origin = 'https://proxi.example';
  assert.equal(chatLinkId('https://proxi.example/?chat=abc-1', origin), 'abc-1');
  assert.equal(chatLinkId('https://other.example/?chat=abc-1', origin), null);
  assert.equal(chatLinkId('https://proxi.example/s/?chat=abc-1', origin), null);
  assert.equal(chatLinkId('https://proxi.example/?chat=a%20b', origin), null);
  assert.equal(chatLinkId('https://proxi.example/', origin), null);
  assert.equal(chatLinkId('not a url', origin), null);
});

test('chat search steps get the chat icon', () => {
  assert.equal(toStep({ done: 'Searched your chats', tool: 'search_chats' }).icon, 'chat');
  assert.match(stepIcon('chat'), /M21 12a8 8 0 0 1/);
});
