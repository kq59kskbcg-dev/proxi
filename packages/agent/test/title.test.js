import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle, makeTitle } from '../src/title.js';

test('titles are cleaned of quotes, labels and ending punctuation', () => {
  assert.equal(cleanTitle('"Planning a trip to Rome."'), 'Planning a trip to Rome');
  assert.equal(cleanTitle('Title: **Budget review**'), 'Budget review');
  assert.equal(cleanTitle('  Two\n lines  '), 'Two');
});

test('long titles are cut at a word boundary within 40 characters', () => {
  const title = cleanTitle('Comparing mortgage options across several European banks today');
  assert.ok(title.length <= 40);
  assert.equal(title, 'Comparing mortgage options across');
});

test('empty output gives no title', () => {
  assert.equal(cleanTitle(''), null);
  assert.equal(cleanTitle('"..."'), null);
});

test('makeTitle asks Haiku with thinking off and returns the cleaned title', async () => {
  let sent;
  const client = { messages: { create: async (params) => {
    sent = params;
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Rome trip ideas.' }], usage: { input_tokens: 20, output_tokens: 4 } };
  } } };
  assert.equal(await makeTitle(client, 'Help me plan 3 days in Rome'), 'Rome trip ideas');
  assert.equal(sent.model, 'claude-haiku-5-5');
  assert.deepEqual(sent.thinking, { type: 'disabled' });
  assert.equal(sent.messages[0].content, 'Help me plan 3 days in Rome');
});

test('makeTitle returns null on errors, refusals and empty messages', async () => {
  const failing = { messages: { create: async () => { throw new Error('down'); } } };
  assert.equal(await makeTitle(failing, 'hello there'), null);
  const refusing = { messages: { create: async () => ({ stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }) } };
  assert.equal(await makeTitle(refusing, 'hello there'), null);
  assert.equal(await makeTitle(failing, '   '), null);
});

