import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wantsPerson, getEscalation } from '../src/escalation.js';

const langfuse = { getPrompt: async () => ({ compile: ({ message }) => `Does this ask for a person? ${message}` }) };
const reply = (text) => ({ messages: { create: async (params) => {
  reply.sent = params;
  return { content: [{ type: 'text', text }] };
} } });

test('wantsPerson is true only when the classifier answers true', async () => {
  assert.equal(await wantsPerson(langfuse, reply(' True\n'), 'I want to talk to a human'), true);
  assert.equal(reply.sent.model, 'claude-haiku-5-5');
  assert.deepEqual(reply.sent.thinking, { type: 'disabled' });
  assert.equal(reply.sent.messages[0].content, 'Does this ask for a person? I want to talk to a human');
  assert.equal(await wantsPerson(langfuse, reply('false'), 'What is Proxi?'), false);
  assert.equal(await wantsPerson(langfuse, reply('maybe'), 'Hmm'), false);
});

test('wantsPerson skips empty messages without calling the model', async () => {
  const client = { messages: { create: async () => { throw new Error('should not be called'); } } };
  assert.equal(await wantsPerson(langfuse, client, '   '), false);
});

test('getEscalation adds nothing when Langfuse is not set up', async () => {
  assert.deepEqual(await getEscalation(reply('true'), 'I want a human'), { escalated: false, text: '' });
});
