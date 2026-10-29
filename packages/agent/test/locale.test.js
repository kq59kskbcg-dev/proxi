import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, getLocale } from '../src/locale.js';

const langfuse = { prompt: { get: async () => ({ compile: ({ message }) => `Language of: ${message}` }) } };
const reply = (text) => ({ messages: { create: async (params) => {
  reply.sent = params;
  return { content: [{ type: 'text', text }] };
} } });

test('detectLanguage asks Haiku with the compiled prompt and returns a two-letter code', async () => {
  assert.equal(await detectLanguage(langfuse, reply(' ES\n'), 'Hola, ¿cómo estás?'), 'es');
  assert.equal(reply.sent.model, 'claude-haiku-5-5');
  assert.deepEqual(reply.sent.thinking, { type: 'disabled' });
  assert.equal(reply.sent.messages[0].content, 'Language of: Hola, ¿cómo estás?');
});

test('detectLanguage ignores answers that are not a two-letter code', async () => {
  assert.equal(await detectLanguage(langfuse, reply('Spanish'), 'Una frase distinta'), null);
  assert.equal(await detectLanguage(langfuse, reply('es'), '   '), null);
});

test('getLocale adds nothing when Langfuse is not set up', async () => {
  assert.deepEqual(await getLocale(reply('es'), 'Hola'), { code: null, text: '' });
});
