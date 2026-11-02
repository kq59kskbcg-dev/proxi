import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeOlder, transcript } from '../src/summary.js';

const older = (tag) => [{ role: 'user', content: `${tag} I am planning a trip` }, { role: 'assistant', content: 'Where to?' }];
const reply = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } });
const fake = (fn) => { const calls = []; return { calls, messages: { create: async (p) => { calls.push(p); return fn(p); } } }; };

test('nothing older means no call', async () => {
  const client = fake(() => reply('x'));
  assert.equal(await summarizeOlder(client, []), '');
  assert.equal(client.calls.length, 0);
});

test('older messages are summarized by Haiku with thinking off', async () => {
  const client = fake(() => reply('  Planning a trip.  '));
  assert.equal(await summarizeOlder(client, older('a')), 'Planning a trip.');
  assert.equal(client.calls[0].model, 'claude-haiku-5-5');
  assert.deepEqual(client.calls[0].thinking, { type: 'disabled' });
  assert.match(client.calls[0].messages[0].content, /User: a I am planning a trip\nAssistant: Where to\?/);
});

test('the same older messages are summarized once', async () => {
  const client = fake(() => reply('Cached.'));
  await summarizeOlder(client, older('b'));
  await summarizeOlder(client, older('b'));
  assert.equal(client.calls.length, 1);
});

test('a failure or a refusal gives no summary and does not throw', async () => {
  assert.equal(await summarizeOlder(fake(() => { throw Object.assign(new Error('x'), { status: 500 }); }), older('c')), '');
  assert.equal(await summarizeOlder(fake(() => ({ ...reply('no'), stop_reason: 'refusal' })), older('d')), '');
});

test('long messages and long chats are cut', () => {
  const long = [{ role: 'user', content: 'x'.repeat(5000) }];
  assert.ok(transcript(long).length < 700);
  const many = Array.from({ length: 200 }, () => ({ role: 'user', content: 'y'.repeat(600) }));
  assert.ok(transcript(many).length <= 30_000);
});
