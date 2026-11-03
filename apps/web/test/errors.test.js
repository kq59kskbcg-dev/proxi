import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { cardResponse, replyError, ERROR_COPY, ERROR_KINDS } from '../lib/errors.js';
import {
  MAX_MESSAGE_CHARS, MAX_EXCHANGES, MAX_CHAT_MESSAGES, MAX_REPLY_CHARS,
  MESSAGE_TOO_LONG, CHAT_FULL, CHAT_TOO_LARGE,
} from '../lib/limits.js';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const apiError = (status) => Anthropic.APIError.generate(status, { error: { type: 'x', message: 'x' } }, 'x', new Headers());

test('a card has a title, one sentence and a reference, and the same words as a line of text', () => {
  const { error, card } = cardResponse('busy', '429');
  assert.deepEqual(card, { title: 'Proxi is busy right now', body: 'Too many requests at once. Try again in a minute.', ref: '429' });
  assert.equal(error, 'Proxi is busy right now. Too many requests at once. Try again in a minute.');
});

test('every card says whose problem it is without blaming the message', () => {
  assert.deepEqual(ERROR_KINDS, ['busy', 'limit', 'session', 'error']);
  assert.match(ERROR_COPY.error.title, /our side/);
  assert.match(ERROR_COPY.error.body, /message is fine/);
  for (const { title, body } of Object.values(ERROR_COPY)) assert.ok(!/shorter message/i.test(title + body));
});

test('a busy or overloaded Claude is "busy"; everything else is on our side, with the status as the reference', () => {
  assert.deepEqual(replyError(apiError(429)), { kind: 'busy', ref: '429' });
  assert.deepEqual(replyError(apiError(529)), { kind: 'busy', ref: '529' });
  // The web search bug: a request Claude rejected. The message was fine.
  assert.deepEqual(replyError(apiError(400)), { kind: 'error', ref: '400' });
  assert.deepEqual(replyError(apiError(401)), { kind: 'error', ref: '401' });
  assert.deepEqual(replyError(apiError(500)), { kind: 'error', ref: '500' });
  assert.deepEqual(replyError(new Anthropic.APIConnectionError({ message: 'down' })), { kind: 'error', ref: 'error' });
  assert.deepEqual(replyError(new Error('boom')), { kind: 'error', ref: 'error' });
});

test('one chat holds 100 of the user\'s messages and a reply to each', () => {
  assert.equal(MAX_EXCHANGES, 100);
  assert.equal(MAX_CHAT_MESSAGES, 200);
  assert.ok(MAX_REPLY_CHARS > MAX_MESSAGE_CHARS, 'a reply can be longer than what a person types');
});

// The page imports the server's own files for these, so they must stay free of imports.
test('the page shares the server\'s limits and error words', async () => {
  for (const file of ['../lib/limits.js', '../lib/error-copy.js']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /^\s*import\b|\bimport\(/m, file + ' must not import anything');
  }
  const ui = await import('../ui/limits.js');
  assert.equal(ui.MAX_MESSAGE_CHARS, MAX_MESSAGE_CHARS);
  assert.equal(ui.MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGES);
  assert.equal(ui.CHAT_FULL, CHAT_FULL);
  assert.deepEqual(ui.OWN_CARDS.error, ERROR_COPY.error);
  assert.match(ui.OWN_CARDS.network.title, /Couldn't reach Proxi/);
});

test('the message box stops at the limit and a card has a Try again button', () => {
  assert.match(page, /:maxlength="v\.maxChars"/);
  assert.match(page, /class="err-retry[^"]*" @click="m\.onRetry">Try again</);
});
