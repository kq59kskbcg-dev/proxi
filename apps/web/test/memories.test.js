import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryOffer } from '../lib/memories.js';
import { parseChatRequest, memoryOf } from '../lib/chat-request.js';
import { MEMORY_LIMIT } from '../lib/db.js';
import { MEMORY_MAX as SERVER_MAX } from '@proxi/agent/memory';
import { MEMORY_MAX, declinePending, memoryCard, MEMORY_DUPLICATE } from '../ui/memory-card.js';
import { toolActivity } from '../lib/activity.js';

test('the page and the server allow the same memory length', () => {
  assert.equal(MEMORY_MAX, SERVER_MAX);
});

test('the model can suggest one memory per reply, and nothing is saved', () => {
  const shown = [];
  const offer = memoryOffer((t) => shown.push(t), ['Prefers short replies']);
  assert.equal(offer.run({ id: 't1', input: { memory: '' } }).is_error, true);
  assert.match(offer.run({ id: 't2', input: { memory: 'Prefers short replies' } }).content, /already saved/);
  const ok = offer.run({ id: 't3', input: { memory: 'Uses metric units' } });
  assert.equal(ok.is_error, false);
  assert.match(ok.content, /Nothing is saved yet/);
  assert.equal(offer.run({ id: 't4', input: { memory: 'Again' } }).is_error, true);
  assert.deepEqual(shown, ['Uses metric units']);
  assert.equal(offer.shown(), 'Uses metric units');
});

test('no card is shown when memory is full', () => {
  const full = Array.from({ length: MEMORY_LIMIT }, (_, i) => 'Fact ' + i);
  const offer = memoryOffer(() => assert.fail('shown'), full);
  assert.equal(offer.run({ id: 't1', input: { memory: 'Uses metric units' } }).is_error, true);
});

test('chat requests keep a reply\'s memory card, and a card-only reply is valid', () => {
  const parsed = parseChatRequest({ model: 'Auto', messages: [
    { role: 'user', content: 'Remember that I use metric units' },
    { role: 'assistant', content: '', memory: { text: 'Uses metric units', status: 'pending' } },
    { role: 'user', content: 'Thanks' },
  ] });
  assert.equal(parsed.error, undefined);
  assert.deepEqual(memoryOf(parsed.messages[1]), { text: 'Uses metric units', status: 'pending' });
  assert.equal(memoryOf({ role: 'user', memory: { text: 'x' } }), null);
});

test('the chat API marks a card left unanswered as declined when another message arrives', () => {
  const source = readFileSync(new URL('../api/chat.js', import.meta.url), 'utf8');
  assert.match(source, /memory\?\.status === 'pending'\) memory\.status = 'declined'/);
});

test('sending a message declines only cards still waiting', () => {
  const messages = [
    { id: 1, role: 'assistant', memory: { text: 'A', status: 'pending' } },
    { id: 2, role: 'assistant', memory: { text: 'B', status: 'saved' } },
    { id: 3, role: 'assistant', text: 'No card' },
  ];
  const after = declinePending(messages);
  assert.equal(after[0].memory.status, 'declined');
  assert.equal(after[1], messages[1]);
  assert.equal(after[2], messages[2]);
  assert.equal(messages[0].memory.status, 'pending');
});

test('each state of the card shows one version of it', () => {
  const shown = (status, form, busy) => {
    const v = memoryCard(status ? { text: 'Uses metric units', status } : null, form, busy);
    return { v, which: ['memoryAsk', 'memorySaved', 'memoryDeclined'].filter((k) => v[k]) };
  };
  assert.deepEqual(shown(null).which, []);
  assert.deepEqual(shown('pending').which, ['memoryAsk']);
  assert.deepEqual(shown('saved').which, ['memorySaved']);
  assert.deepEqual(shown('declined').which, ['memoryDeclined']);
  assert.equal(shown('pending', { text: 'Uses metric units for cooking' }).v.memoryText, 'Uses metric units for cooking');
  assert.equal(shown('pending', { saving: true }).v.memorySaveLabel, 'Saving...');
  assert.equal(shown('pending', {}, true).v.memoryBusy, true);
  assert.equal(shown('saved', { duplicate: true }).v.memoryDone, MEMORY_DUPLICATE);
  assert.equal(shown('saved').v.memoryDone, 'Uses metric units');
});

test('the activity step says a memory was suggested, not saved', () => {
  assert.equal(toolActivity('save_memory').done, 'Suggested a memory');
});
