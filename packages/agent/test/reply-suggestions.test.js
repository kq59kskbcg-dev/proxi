import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuggestions, suggestReplies, suggestionKey } from '../src/reply-suggestions.js';

const langfuse = { prompt: { get: async () => ({ compile: ({ reply }) => `R: ${reply}` }) } };
const answering = (text, extra = {}) => {
  const client = { sent: [], messages: { create: async (params, options) => {
    client.sent.push({ params, options });
    return { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 50, output_tokens: 5 }, ...extra };
  } } };
  return client;
};

test('parseSuggestions keeps 2 or 3 short, distinct options', () => {
  assert.deepEqual(parseSuggestions('["Yes", "No"]'), ['Yes', 'No']);
  assert.deepEqual(parseSuggestions(' ["2 pm","3 pm","4 pm"]\n'), ['2 pm', '3 pm', '4 pm']);
  assert.deepEqual(parseSuggestions('```json\n["Approve", "Reject"]\n```'), ['Approve', 'Reject']);
  assert.deepEqual(parseSuggestions('["  Short   example ", "Step by step"]'), ['Short example', 'Step by step']);
});

test('parseSuggestions gives none for anything else', () => {
  assert.deepEqual(parseSuggestions('[]'), []);
  assert.deepEqual(parseSuggestions('["Yes"]'), []);
  assert.deepEqual(parseSuggestions('["A", "B", "C", "D"]'), []);
  assert.deepEqual(parseSuggestions('Yes, No'), []);
  assert.deepEqual(parseSuggestions('{"options": ["Yes", "No"]}'), []);
  assert.deepEqual(parseSuggestions('["Yes", 2]'), []);
  assert.deepEqual(parseSuggestions('["Yes", ""]'), []);
  assert.deepEqual(parseSuggestions('["Yes", "yes"]'), []);
  assert.deepEqual(parseSuggestions(`["Yes", "${'x'.repeat(31)}"]`), []);
});

test('suggestReplies asks Haiku with the end of the reply and a 2 second timeout', async () => {
  const client = answering('["Yes", "No"]');
  const reply = 'a'.repeat(3000) + ' Should I send it?';
  assert.deepEqual(await suggestReplies(langfuse, client, reply), ['Yes', 'No']);
  const { params, options } = client.sent[0];
  assert.equal(params.model, 'claude-haiku-5-5');
  assert.deepEqual(params.thinking, { type: 'disabled' });
  assert.equal(params.messages[0].content.length, 'R: '.length + 1500);
  assert.ok(params.messages[0].content.endsWith('Should I send it?'));
  assert.deepEqual(options, { timeout: 2000, maxRetries: 0 });
});

test('suggestReplies gives none without Langfuse, on errors, refusals and empty replies', async () => {
  assert.deepEqual(await suggestReplies(null, answering('["Yes", "No"]'), 'Ok?'), []);
  const failing = { messages: { create: async () => { throw new Error('down'); } } };
  assert.deepEqual(await suggestReplies(langfuse, failing, 'Ok?'), []);
  assert.deepEqual(await suggestReplies(langfuse, answering('["Yes", "No"]', { stop_reason: 'refusal' }), 'Ok?'), []);
  const client = answering('["Yes", "No"]');
  assert.deepEqual(await suggestReplies(langfuse, client, '   '), []);
  assert.equal(client.sent.length, 0);
  const missing = { prompt: { get: async () => { throw new Error("Prompt not found: 'classifiers/reply-suggestions'"); } } };
  assert.deepEqual(await suggestReplies(missing, client, 'Ok?'), []);
});

test('suggestReplies gives up after 2 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hanging = { messages: { create: () => new Promise(() => {}) } };
  const pending = suggestReplies(langfuse, hanging, 'Ok?');
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2000);
  assert.deepEqual(await pending, []);
});

test('suggestReplies records a generation on the trace', async () => {
  const updates = [];
  const trace = { startObservation: (name, attrs, opts) => {
    updates.push({ name, attrs, opts });
    return { update: (u) => { updates.push(u); return { end: () => {} }; } };
  } };
  await suggestReplies(langfuse, answering('["Yes", "No"]'), 'Ok?', trace);
  assert.equal(updates[0].name, 'suggestions');
  assert.deepEqual(updates[0].opts, { asType: 'generation' });
  assert.equal(updates[1].output, '["Yes", "No"]');
});

test('suggestionKey matches the same options in any order or case', () => {
  assert.equal(suggestionKey('["Yes", "No"]'), suggestionKey(['no', 'YES']));
  assert.equal(suggestionKey([]), suggestionKey('[]'));
  assert.notEqual(suggestionKey(['Yes', 'No']), suggestionKey([]));
  assert.notEqual(suggestionKey(['Yes', 'No']), suggestionKey(['Yes', 'No', 'Maybe']));
});
