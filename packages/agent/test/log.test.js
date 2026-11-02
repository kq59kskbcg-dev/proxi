import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { log } from '../src/log.js';

let lines;
const saved = {};
beforeEach(() => {
  lines = [];
  for (const level of ['error', 'warn', 'log']) {
    saved[level] = console[level];
    console[level] = (line) => lines.push({ level, line: JSON.parse(line) });
  }
});
afterEach(() => { for (const level of Object.keys(saved)) console[level] = saved[level]; });

test('writes one JSON line per event at the right level', () => {
  log.error('db.query_failed', { code: '42P01' });
  log.warn('rate.limited', { count: 3 });
  log.info('cleanup.done', { deleted: 2, removed: 0 });
  assert.deepEqual(lines, [
    { level: 'error', line: { level: 'error', event: 'db.query_failed', code: '42P01' } },
    { level: 'warn', line: { level: 'warn', event: 'rate.limited', count: 3 } },
    { level: 'log', line: { level: 'info', event: 'cleanup.done', deleted: 2, removed: 0 } },
  ]);
});

test('an error gives its code, class name and status, never its message or stack', () => {
  class NeonDbError extends Error {}
  const error = Object.assign(new NeonDbError('relation "secret@example.com" does not exist'), { code: '42P01' });
  log.error('x.failed', { error });
  assert.deepEqual(lines[0].line, { level: 'error', event: 'x.failed', code: '42P01', name: 'NeonDbError' });

  class RateLimitError extends Error {}
  log.error('y.failed', { error: Object.assign(new RateLimitError('slow down'), { status: 429 }) });
  assert.deepEqual(lines[1].line, { level: 'error', event: 'y.failed', name: 'RateLimitError', status: 429 });

  log.error('z.failed', { error: 'just a string with an email a@b.co' });
  assert.deepEqual(lines[2].line, { level: 'error', event: 'z.failed', name: 'string' });
});

test('drops fields that are not on the allowlist or not identifier-shaped', () => {
  log.error('chat.failed', {
    userId: 'user_123', content: 'my card is 4111 1111 1111 1111', prompt: 'You are Proxi',
    email: 'a@b.co', reason: 'has spaces in it', kind: 'pdf', status: 500, code: { nested: true },
  });
  assert.deepEqual(lines[0].line, { level: 'error', event: 'chat.failed', kind: 'pdf', status: 500 });
});

test('an event name that is not identifier-shaped is replaced', () => {
  log.info('Hello from a@b.co');
  assert.equal(lines[0].line.event, 'invalid-event');
});
