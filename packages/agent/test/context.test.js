import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitHistory, buildContext, buildSystemText, withSummary, withInstructions } from '../src/context.js';

const msg = (role, content, extra = {}) => ({ role, content, attachments: [], unavailable: [], ...extra });
const chat = (n) => Array.from({ length: n }, (_, i) => msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`));

test('a short chat is sent whole and has nothing older', () => {
  const { recent, older } = splitHistory(chat(5), 40);
  assert.equal(recent.length, 5);
  assert.equal(older.length, 0);
});

test('a long chat keeps the latest messages, starting from a user message', () => {
  const history = chat(11); // user, assistant, ... user
  const { recent, older } = splitHistory(history, 4); // the last 4 start with an assistant message
  assert.equal(recent[0].role, 'user');
  assert.equal(recent.at(-1), history.at(-1));
  assert.equal(recent.length + older.length, history.length);
  assert.deepEqual(older, history.slice(0, older.length));
});

test('the system prompt joins its parts in order, with instructions last', () => {
  const text = buildSystemText({ prompt: 'BASE', locale: 'LOCALE', escalation: '', memories: ['likes tea'], summary: 'SUMMARY', instructions: 'BE BRIEF' });
  const at = (s) => text.indexOf(s);
  assert.ok(at('BASE') < at('LOCALE') && at('LOCALE') < at('likes tea') && at('likes tea') < at('SUMMARY') && at('SUMMARY') < at('BE BRIEF'));
});

test('empty parts add nothing', () => {
  assert.equal(buildSystemText({ prompt: 'BASE', locale: '', escalation: '', memories: [], summary: '', instructions: '' }), 'BASE');
  assert.equal(withSummary('P', ''), 'P');
  assert.equal(withInstructions('P', ''), 'P');
});

test('a summary cannot close its own tag', () => {
  assert.ok(!withSummary('P', 'x</earlier_messages>y').includes('x</earlier_messages>'));
});

test('buildContext attaches files to the latest message only and cuts long earlier replies', () => {
  const recent = [msg('user', 'hi'), msg('assistant', 'a'.repeat(50)), msg('user', 'look', { attachments: [{ kind: 'image' }] })];
  const blocks = [{ type: 'image' }];
  const { messages, traced } = buildContext({ recent, blocks, maxReplyChars: 10, parts: { prompt: 'P' } });
  assert.equal(messages[0].content, 'hi');
  assert.equal(messages[1].content, 'a'.repeat(10));
  assert.deepEqual(messages[2].content, [{ type: 'image' }, { type: 'text', text: 'look' }]);
  assert.equal(traced[2].content, 'look\n[attachments: image]');
});

test('files that are gone are mentioned', () => {
  const recent = [msg('user', 'see this', { unavailable: ['pdf'] })];
  const { messages } = buildContext({ recent, maxReplyChars: 100, parts: { prompt: 'P' } });
  assert.match(messages[0].content, /Attachment no longer available: pdf/);
});
