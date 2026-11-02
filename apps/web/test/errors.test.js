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
const pageLimits = readFileSync(new URL('../ui/limits.js', import.meta.url), 'utf8');
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

// The page can't import from lib/, so it repeats these. They must not drift apart.
test('the page repeats the same limits and words as the server', () => {
  assert.ok(pageLimits.includes(`export const MAX_MESSAGE_CHARS = ${MAX_MESSAGE_CHARS};`));
  assert.ok(pageLimits.includes(`export const MAX_CHAT_MESSAGES = ${MAX_CHAT_MESSAGES};`));
  for (const text of [MESSAGE_TOO_LONG, CHAT_FULL, CHAT_TOO_LARGE]) assert.ok(pageLimits.includes(`'${text}'`), text);
});

test('the page\'s own cards match the server\'s for "something went wrong", and a lost connection has its own', () => {
  const { title, body } = ERROR_COPY.error;
  assert.ok(pageLimits.includes(`error: { title: '${title}', body: '${body}' }`));
  assert.ok(pageLimits.includes(`network: { title: "Couldn't reach Proxi"`));
});

test('the message box stops at the limit and a card has a Try again button', () => {
  assert.match(page, /:maxlength="v\.maxChars"/);
  assert.match(page, /class="err-retry[^"]*" @click="m\.onRetry">Try again</);
});
