import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseModel, routingVariables } from '../src/routing.js';

// No Langfuse keys in tests, so the built-in copy of the routing prompt is used.
const reply = (text) => ({ messages: { create: async (params) => {
  reply.sent = params;
  return { content: [{ type: 'text', text }] };
} } });
const chat = (...contents) => contents.map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content }));

test('chooseModel maps simple, standard and complex to Haiku, Sonnet and Opus', async () => {
  assert.deepEqual(await chooseModel(reply('simple'), chat('Thanks!')), { level: 'simple', model: 'claude-haiku-5-5' });
  assert.equal(reply.sent.model, 'claude-haiku-5-5');
  assert.deepEqual(reply.sent.thinking, { type: 'disabled' });
  assert.match(reply.sent.messages[0].content, /Reply with exactly one word[\s\S]*Message:\nThanks!$/);
  assert.deepEqual(await chooseModel(reply(' Standard\n'), chat('Summarize this')), { level: 'standard', model: 'claude-sonnet-5-5' });
  assert.deepEqual(await chooseModel(reply('complex'), chat('Design a system')), { level: 'complex', model: 'claude-opus-5-5' });
});

test('chooseModel falls back to the standard model on an unclear answer or an error', async () => {
  assert.deepEqual(await chooseModel(reply('it depends'), chat('Hmm')), { level: 'standard', model: 'claude-sonnet-5-5' });
  const failing = { messages: { create: async () => { throw Object.assign(new Error('overloaded'), { status: 529 }); } } };
  assert.deepEqual(await chooseModel(failing, chat('Hi')), { level: 'standard', model: 'claude-sonnet-5-5' });
});

test('routingVariables gives the earlier messages as context and notes attachments', () => {
  assert.deepEqual(routingVariables(chat('Hi')), { context: '(none)', message: 'Hi' });
  const history = chat('Plan a trip', 'Here is a plan.', 'why?');
  history[2].attachments = [{ kind: 'pdf' }];
  assert.deepEqual(routingVariables(history), {
    context: 'User: Plan a trip\nAssistant: Here is a plan.',
    message: 'why?\n(The message comes with an attachment.)',
  });
});
