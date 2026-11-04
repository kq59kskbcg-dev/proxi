import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { setDriver, saveConversation, listConversations, getMessages, deleteConversation, deleteAccountData, deleteInactiveConversations, getSettings, saveSettings, conversationAttributes, markContactSent, markMemory, listMemories, addMemory, deleteMemory, MEMORY_LIMIT } from '../lib/db.js';

let pg;
before(() => {
  pg = new PGlite();
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
    { role: 'user', content: 'Plan a trip to Lisbon', model: null, traceId: null, attachments: null, contact: null, memory: null },
    { role: 'assistant', content: 'Day 1: Alfama.', model: 'claude-sonnet-5-5', traceId: 'trace-1', attachments: null, contact: null, memory: null },
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
  assert.deepEqual(await deleteConversation('user_a', 'c1'), ['trace-1']);
  assert.deepEqual(await getMessages('user_a', 'c1'), []);
  assert.deepEqual((await listConversations('user_a')).map((c) => c.id), ['c2']);
  assert.equal((await getMessages('user_b', 'c1')).length, 1);
});

test('remembers which kinds of files were attached, but nothing else about them', async () => {
  await saveConversation('user_a', 'c3', 'With files', [
    { role: 'user', content: '', attachments: [{ kind: 'image' }, { kind: 'pdf' }] },
    { role: 'assistant', content: 'I see a chart.' },
  ]);
  const [first, second] = await getMessages('user_a', 'c3');
  assert.deepEqual(first.attachments, [{ kind: 'image' }, { kind: 'pdf' }]);
  assert.equal(second.attachments, null);
});

test('a saved chat keeps its title unless a new title is asked for', async () => {
  await saveConversation('user_t', 't1', 'Plan a trip to Lisbon', chat);
  await saveConversation('user_t', 't1', 'Something else', chat);
  assert.equal((await listConversations('user_t'))[0].title, 'Plan a trip to Lisbon');
  await saveConversation('user_t', 't1', 'Lisbon trip plan', chat, { replaceTitle: true });
  assert.equal((await listConversations('user_t'))[0].title, 'Lisbon trip plan');
});

test('chats inactive for longer than the retention period are deleted with their messages', async () => {
  await saveConversation('user_r', 'old', 'Old chat', chat);
  await saveConversation('user_r', 'new', 'New chat', chat);
  await pg.query(`UPDATE conversations SET updated_at = now() - interval '91 days' WHERE user_id = 'user_r' AND id = 'old'`);
  assert.deepEqual(await deleteInactiveConversations(90), { deleted: 1, traceIds: ['trace-1'] });
  assert.deepEqual((await listConversations('user_r')).map((c) => c.id), ['new']);
  assert.deepEqual(await getMessages('user_r', 'old'), []);
  assert.equal((await getMessages('user_r', 'new')).length, 2);
});

test('settings default to 30 days and can be changed per user', async () => {
  assert.deepEqual(await getSettings('user_s'), { chatRetentionDays: 30, customInstructions: '' });
  await saveSettings('user_s', { chatRetentionDays: 7 });
  assert.deepEqual(await getSettings('user_s'), { chatRetentionDays: 7, customInstructions: '' });
  assert.deepEqual(await getSettings('user_other'), { chatRetentionDays: 30, customInstructions: '' });
});

test('cleanup follows each user\'s own retention, or the 30 day default', async () => {
  await saveSettings('user_short', { chatRetentionDays: 7 });
  await saveConversation('user_short', 'x', 'Eight days old', chat);
  await saveConversation('user_default', 'x', 'Eight days old', chat);
  await saveConversation('user_default', 'y', 'Forty days old', chat);
  await pg.query(`UPDATE conversations SET updated_at = now() - interval '8 days' WHERE id = 'x' AND user_id IN ('user_short', 'user_default')`);
  await pg.query(`UPDATE conversations SET updated_at = now() - interval '40 days' WHERE id = 'y' AND user_id = 'user_default'`);
  await deleteInactiveConversations();
  assert.deepEqual((await listConversations('user_short')).map((c) => c.id), []);
  assert.deepEqual((await listConversations('user_default')).map((c) => c.id), ['x']);
});

test('a chat keeps its first language and stays escalated once it has been', async () => {
  assert.deepEqual(await conversationAttributes('user_a', 'attrs'), { language: null, escalated: false });
  await saveConversation('user_a', 'attrs', 'Hola', chat, { language: 'es' });
  assert.deepEqual(await conversationAttributes('user_a', 'attrs'), { language: 'es', escalated: false });
  await saveConversation('user_a', 'attrs', 'Hola', chat, { language: 'en', escalated: true });
  assert.deepEqual(await conversationAttributes('user_a', 'attrs'), { language: 'es', escalated: true });
  await saveConversation('user_a', 'attrs', 'Hola', chat, { language: null, escalated: false });
  assert.deepEqual(await conversationAttributes('user_a', 'attrs'), { language: 'es', escalated: true });
  assert.deepEqual(await conversationAttributes('user_b', 'attrs'), { language: null, escalated: false });
});

test('memories are saved once per user, listed oldest first, capped and deletable', async () => {
  assert.equal(await addMemory('mem_a', 'm1', 'Prefers metric units'), 'saved');
  assert.equal(await addMemory('mem_a', 'm2', 'Works as a designer'), 'saved');
  assert.equal(await addMemory('mem_a', 'm3', 'Prefers metric units'), 'duplicate');
  assert.deepEqual((await listMemories('mem_a')).map((m) => m.content), ['Prefers metric units', 'Works as a designer']);
  assert.deepEqual(await listMemories('mem_b'), []);
  await deleteMemory('mem_b', 'm1');
  assert.equal((await listMemories('mem_a')).length, 2, 'another user cannot delete them');
  await deleteMemory('mem_a', 'm1');
  assert.deepEqual((await listMemories('mem_a')).map((m) => m.id), ['m2']);
  for (let i = 0; i < MEMORY_LIMIT; i++) await addMemory('mem_c', 'c' + i, 'Fact ' + i);
  assert.equal(await addMemory('mem_c', 'over', 'One too many'), 'full');
});

test('deleting an account removes the user\'s chats, memories and settings, and returns their trace IDs', async () => {
  await saveConversation('user_gone', 'a', 'One', chat);
  await saveConversation('user_gone', 'b', 'Two', [chat[0], { ...chat[1], traceId: 'trace-2' }]);
  await saveSettings('user_gone', { chatRetentionDays: 7, customInstructions: 'Be brief' });
  await addMemory('user_gone', 'm1', 'Likes tea');
  await saveConversation('user_kept', 'a', 'Kept', chat);
  await addMemory('user_kept', 'm1', 'Likes coffee');

  assert.deepEqual((await deleteAccountData('user_gone')).sort(), ['trace-1', 'trace-2']);
  assert.deepEqual(await listConversations('user_gone'), []);
  assert.deepEqual(await listMemories('user_gone'), []);
  assert.deepEqual(await getSettings('user_gone'), { chatRetentionDays: 30, customInstructions: '' });
  assert.equal((await listConversations('user_kept')).length, 1);
  assert.equal((await listMemories('user_kept')).length, 1);
});

test('a reply keeps its Message Lisandro card, and Send marks only that card as sent', async () => {
  const card = { summary: 'Their shared link stopped opening.', sent: false };
  await saveConversation('user_card', 'c1', 'Help', [
    { role: 'user', content: 'Can I talk to a person?' },
    { role: 'assistant', content: 'Add your email in the card.', contact: card },
  ]);
  assert.deepEqual((await getMessages('user_card', 'c1'))[1].contact, card);
  await markContactSent('user_other', 'c1', 1);
  await markContactSent('user_card', 'c1', 0);
  assert.equal((await getMessages('user_card', 'c1'))[1].contact.sent, false);
  await markContactSent('user_card', 'c1', 1);
  const messages = await getMessages('user_card', 'c1');
  assert.deepEqual(messages[1].contact, { summary: card.summary, sent: true });
  assert.equal(messages[0].contact, null);
});

test('a reply keeps its Save to memory card, and only a waiting card can be answered', async () => {
  const card = { text: 'Uses metric units', status: 'pending' };
  await saveConversation('user_mem', 'c1', 'Units', [
    { role: 'user', content: 'Remember that I use metric units' },
    { role: 'assistant', content: 'Check the card.', memory: card },
    { role: 'user', content: 'Thanks' },
    { role: 'assistant', content: 'Check this one too.', memory: { text: 'Cooks often', status: 'pending' } },
  ]);
  assert.deepEqual((await getMessages('user_mem', 'c1'))[1].memory, card);
  await markMemory('user_other', 'c1', 1, 'saved', 'Uses metric units');
  await markMemory('user_mem', 'c1', 0, 'saved', 'Uses metric units');
  assert.equal((await getMessages('user_mem', 'c1'))[1].memory.status, 'pending');
  await markMemory('user_mem', 'c1', 1, 'saved', 'Uses metric units for cooking');
  await markMemory('user_mem', 'c1', 3, 'declined');
  let messages = await getMessages('user_mem', 'c1');
  assert.deepEqual(messages[1].memory, { text: 'Uses metric units for cooking', status: 'saved' });
  assert.deepEqual(messages[3].memory, { text: 'Cooks often', status: 'declined' });
  await markMemory('user_mem', 'c1', 1, 'declined');
  messages = await getMessages('user_mem', 'c1');
  assert.equal(messages[1].memory.status, 'saved');
  assert.equal(messages[0].memory, null);
});
