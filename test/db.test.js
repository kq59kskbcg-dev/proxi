import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { setDriver, saveConversation, listConversations, getMessages, deleteConversation } from '../lib/db.js';

before(() => {
  const pg = new PGlite();
  setDriver({
    query: async (text, params) => (await pg.query(text, params)).rows,
    transaction: (steps) => pg.transaction(async (tx) => {
      for (const [text, params] of steps) await tx.query(text, params);
    }),
  });
});

const chat = [
  { role: 'user', content: 'Plan a trip to Lisbon' },
  { role: 'assistant', content: 'Day 1: Alfama.', model: 'claude-sonnet-5-5', traceId: 'trace-1' },
];

test('saves a chat and reads it back in order', async () => {
  await saveConversation('user_a', 'c1', 'Plan a trip to Lisbon', chat);
  assert.deepEqual(await getMessages('user_a', 'c1'), [
    { role: 'user', content: 'Plan a trip to Lisbon', model: null, traceId: null },
    { role: 'assistant', content: 'Day 1: Alfama.', model: 'claude-sonnet-5-5', traceId: 'trace-1' },
  ]);
  const list = await listConversations('user_a');
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Plan a trip to Lisbon');
});

test('users never see each other\'s chats, even with the same chat ID', async () => {
  await saveConversation('user_b', 'c1', 'Secret plans', [{ role: 'user', content: 'B only' }]);
  assert.equal((await getMessages('user_a', 'c1'))[0].content, 'Plan a trip to Lisbon');
  assert.equal((await getMessages('user_b', 'c1'))[0].content, 'B only');
  assert.deepEqual((await listConversations('user_b')).map((c) => c.title), ['Secret plans']);
  assert.deepEqual(await getMessages('user_c', 'c1'), []);
});

test('saving again replaces the messages, so edits and regenerations stick', async () => {
  await saveConversation('user_a', 'c1', 'ignored new title', [chat[0], { role: 'assistant', content: 'A new take.' }]);
  const messages = await getMessages('user_a', 'c1');
  assert.deepEqual(messages.map((m) => m.content), ['Plan a trip to Lisbon', 'A new take.']);
  assert.equal((await listConversations('user_a'))[0].title, 'Plan a trip to Lisbon');
});

test('most recently updated chat comes first', async () => {
  await saveConversation('user_a', 'c2', 'Second chat', [{ role: 'user', content: 'hi' }]);
  assert.deepEqual((await listConversations('user_a')).map((c) => c.id), ['c2', 'c1']);
  await saveConversation('user_a', 'c1', 'x', chat);
  assert.deepEqual((await listConversations('user_a')).map((c) => c.id), ['c1', 'c2']);
});

test('deleting removes the chat and its messages, only for that user', async () => {
  await deleteConversation('user_a', 'c1');
  assert.deepEqual(await getMessages('user_a', 'c1'), []);
  assert.deepEqual((await listConversations('user_a')).map((c) => c.id), ['c2']);
  assert.equal((await getMessages('user_b', 'c1')).length, 1);
});
