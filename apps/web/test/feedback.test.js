import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST, setLangfuse } from '../api/feedback.js';
import { MAX_REQUESTS } from '../lib/ratelimit.js';
import { useTestDatabase } from './helpers/db.js';
import { useTestSignIn } from './helpers/auth.js';

let sign, token, scores, failWith;
before(() => {
  useTestDatabase();
  sign = useTestSignIn();
  token = sign({ sub: 'user_fb' });
});
beforeEach(() => {
  scores = [];
  failWith = null;
  setLangfuse({
    score: { create: async (s) => { if (failWith) throw failWith; scores.push(s); } },
    flush: async () => {},
  });
});

const send = (body, auth = token) => POST(new Request('http://localhost/api/feedback', {
  method: 'POST',
  headers: { host: 'localhost', 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));

test('needs a signed-in user', async () => {
  const res = await send({ traceId: 'trace-123', value: 1 }, null);
  assert.equal(res.status, 401);
  assert.equal(await res.text(), '');
});

test('stores a thumbs up or down as a score on the trace', async () => {
  assert.equal((await send({ traceId: 'trace-123', value: 1 })).status, 204);
  assert.equal((await send({ traceId: 'trace-123', value: 0 })).status, 204);
  assert.deepEqual(scores, [
    { traceId: 'trace-123', name: 'user-feedback', value: 1, dataType: 'BOOLEAN' },
    { traceId: 'trace-123', name: 'user-feedback', value: 0, dataType: 'BOOLEAN' },
  ]);
  // Clearing a vote stores nothing.
  assert.equal((await send({ traceId: 'trace-123', value: null })).status, 204);
  assert.equal(scores.length, 2);
});

test('rejects malformed requests', async () => {
  for (const body of ['not json', { traceId: 'x', value: 1 }, { traceId: 'trace-123', value: 2 }, { traceId: 'trace 123!', value: 1 }, {}]) {
    assert.equal((await send(body)).status, 400);
  }
});

test('a failed score still answers 204, and is logged without content', async () => {
  failWith = Object.assign(new Error('network down for user@example.com'), { status: 503 });
  const lines = [];
  const error = console.error;
  console.error = (line) => lines.push(JSON.parse(line));
  try {
    assert.equal((await send({ traceId: 'trace-456', value: 1 })).status, 204);
  } finally {
    console.error = error;
  }
  assert.deepEqual(lines, [{ level: 'error', event: 'feedback.score_failed', name: 'Error', status: 503, traceId: 'trace-456' }]);
});

test('feedback has its own rate limit, separate from chat', async () => {
  const other = sign({ sub: 'user_fb_limit' });
  for (let i = 0; i < MAX_REQUESTS; i++) assert.equal((await send({ traceId: 'trace-123', value: 1 }, other)).status, 204);
  assert.equal((await send({ traceId: 'trace-123', value: 1 }, other)).status, 429);
  const { rateLimit } = await import('../lib/ratelimit.js');
  assert.equal((await rateLimit('user_fb_limit')).ok, true);
});
