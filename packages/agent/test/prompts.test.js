import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getPrompt, getSnippet, classify } from '../src/langfuse.js';

const fetched = (text) => ({ prompt: { get: async (name, options) => {
  fetched.calls.push({ name, options });
  return { isFallback: false, compile: (v = {}) => text.replace('{{message}}', v.message ?? '') };
} } });
fetched.calls = [];
const failing = (error) => ({ prompt: { get: async () => { throw error; } } });
const warnings = () => mock.method(console, 'warn', () => {});

test('getPrompt fetches the production label with the shared options', async () => {
  fetched.calls = [];
  const prompt = await getPrompt('summarizers/conversation-title', { fallback: 'built-in', langfuse: fetched('From Langfuse') });
  assert.equal(prompt.compile(), 'From Langfuse');
  assert.ok(prompt.prompt, 'a fetched prompt is linked to the trace');
  assert.deepEqual(fetched.calls[0], {
    name: 'summarizers/conversation-title',
    options: { label: 'production', cacheTtlSeconds: 60, fetchTimeoutMs: 2000, fallback: 'built-in' },
  });
  await getPrompt('classifiers/language', { langfuse: fetched('x') });
  assert.deepEqual(fetched.calls[1].options, { label: 'production', cacheTtlSeconds: 60, fetchTimeoutMs: 2000 });
});

test('without Langfuse, getPrompt uses the built-in prompt silently and fills in variables', async () => {
  const warn = warnings();
  const prompt = await getPrompt('x', { fallback: 'Hi {{name}}, {{other}} $& {{name}}', langfuse: null });
  assert.equal(prompt.prompt, undefined);
  assert.equal(prompt.compile({ name: 'Ann $1' }), 'Hi Ann $1, {{other}} $& Ann $1');
  await assert.rejects(getPrompt('x', { langfuse: null }));
  assert.equal(warn.mock.callCount(), 0);
  warn.mock.restore();
});

test('a prompt that falls back to the built-in copy is logged with its name and status only', async () => {
  const warn = warnings();
  const prompt = await getPrompt('main-system', { fallback: 'secret built-in text', langfuse: failing(Object.assign(new Error('user said hello'), { status: 503 })) });
  assert.equal(prompt.compile(), 'secret built-in text');
  assert.equal(prompt.prompt, undefined);
  const fallbackFromSdk = { prompt: { get: async () => ({ isFallback: true, compile: () => 'sdk copy' }) } };
  assert.equal((await getPrompt('main-system', { fallback: 'built-in', langfuse: fallbackFromSdk })).prompt, undefined);
  assert.deepEqual(warn.mock.calls.map((c) => JSON.parse(c.arguments[0])), [
    { event: 'prompt_fallback', prompt: 'main-system', error: '503' },
    { event: 'prompt_fallback', prompt: 'main-system', error: 'fallback' },
  ]);
  warn.mock.restore();
});

test('a snippet that cannot be fetched is skipped and logged', async () => {
  const warn = warnings();
  assert.equal(await getSnippet('snippets/escalation-reply', { langfuse: fetched('Talk to us') }), 'Talk to us');
  assert.equal(await getSnippet('locale-de/tone', { langfuse: failing(Object.assign(new Error('nope'), { name: 'NotFoundError' })) }), '');
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(warn.mock.calls[0].arguments[0]), { event: 'snippet_skipped', prompt: 'locale-de/tone', error: 'NotFoundError' });
  warn.mock.restore();
});

test('classify asks the small model and returns its trimmed, lower case answer', async () => {
  let sent;
  const client = { messages: { create: async (params, options) => { sent = { params, options }; return { content: [{ type: 'text', text: ' YES \n' }] }; } } };
  assert.equal(await classify(client, 'classifiers/escalation', { message: 'hi' }, { langfuse: fetched('Q: {{message}}') }), 'yes');
  assert.deepEqual(sent.params, {
    model: 'claude-haiku-5-5', max_tokens: 8, thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: 'Q: hi' }],
  });
  assert.deepEqual(sent.options, { timeout: 5000, maxRetries: 0 });
  await assert.rejects(classify(client, 'classifiers/escalation', { message: 'hi' }, { langfuse: failing(new Error('down')) }));
});
