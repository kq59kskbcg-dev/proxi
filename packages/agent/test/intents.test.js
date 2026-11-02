import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, getIntent, intentText } from '../src/intents.js';

const history = [{ role: 'user', content: 'My IBAN was not redacted' }];
const langfuse = ({ tagged = {}, texts = {} } = {}) => ({
  prompt: { get: async (name) => {
    if (name === 'classifiers/intent-router') return { compile: ({ context, message }) => `Route (${context}): ${message}` };
    if (!(name in texts)) throw new Error(`Prompt not found: '${name}'`);
    return { compile: () => texts[name] };
  } },
  api: { prompts: { list: async ({ tag }) => ({ data: (tagged[tag] ?? []).map((name) => ({ name })) }) } },
});
const reply = (text) => ({ messages: { create: async (params) => {
  reply.sent = params;
  return { content: [{ type: 'text', text }] };
} } });

test('classifyIntent returns the intent the router names, and null for none or anything else', async () => {
  assert.equal(await classifyIntent(langfuse(), reply(' Redaction-Missed\n'), history), 'redaction-missed');
  assert.equal(reply.sent.model, 'claude-haiku-5-5');
  assert.deepEqual(reply.sent.thinking, { type: 'disabled' });
  assert.equal(reply.sent.messages[0].content, 'Route ((none)): My IBAN was not redacted');
  assert.equal(await classifyIntent(langfuse(), reply('none'), history), null);
  assert.equal(await classifyIntent(langfuse(), reply('I think this is about cards.'), history), null);
});

test('classifyIntent skips empty messages without calling the model', async () => {
  const client = { messages: { create: async () => { throw new Error('should not be called'); } } };
  assert.equal(await classifyIntent(langfuse(), client, [{ role: 'user', content: '   ' }]), null);
});

test('getIntent adds nothing when Langfuse is not set up', async () => {
  assert.deepEqual(await getIntent(reply('escalation'), history), { intent: null, escalated: false, text: '' });
});

test('intentText joins the production prompts tagged for the intent and skips the others', async () => {
  const lf = langfuse({
    tagged: { 'on-redaction-missed': ['snippets/b', 'snippets/a', 'snippets/draft'] },
    texts: { 'snippets/a': 'A', 'snippets/b': 'B' },
  });
  assert.equal(await intentText(lf, 'redaction-missed'), 'A\n\nB');
  assert.equal(await intentText(lf, 'unknown-intent'), '');
});
