import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setDriver, pruneRateLimits } from '../lib/db.js';
import { rateLimit, ipKey, resetRateLimits, WINDOW_MS, MAX_REQUESTS } from '../lib/ratelimit.js';
import { useTestDatabase } from './helpers/db.js';

let pg;
beforeEach(() => { pg = useTestDatabase(); resetRateLimits(); });

const T0 = 1_700_000_000_000;

test('the shared limit allows MAX_REQUESTS in a window, then refuses with retryAfter', async () => {
  for (let i = 0; i < MAX_REQUESTS; i++) assert.deepEqual(await rateLimit('u1', T0 + i * 1000), { ok: true });
  assert.deepEqual(await rateLimit('u1', T0 + 30_000), { ok: false, retryAfter: (WINDOW_MS - 30_000) / 1000 });
  assert.equal((await rateLimit('u2', T0 + 30_000)).ok, true);
  // Refused requests aren't counted, so the wait doesn't grow; the window slides.
  assert.equal((await rateLimit('u1', T0 + WINDOW_MS - 1)).ok, false);
  assert.equal((await rateLimit('u1', T0 + WINDOW_MS)).ok, true);
  assert.equal((await rateLimit('u1', T0 + WINDOW_MS)).ok, false);
});

test('concurrent requests never get past the limit', async () => {
  const results = await Promise.all(Array.from({ length: MAX_REQUESTS * 2 }, () => rateLimit('busy', T0)));
  assert.equal(results.filter((r) => r.ok).length, MAX_REQUESTS);
  const [row] = (await pg.query(`SELECT cardinality(hits) AS n FROM rate_limits WHERE key = 'busy'`)).rows;
  assert.equal(row.n, MAX_REQUESTS);
});

test('it is shared: a second instance sees the first one\'s requests', async () => {
  for (let i = 0; i < MAX_REQUESTS; i++) await rateLimit('u1', T0);
  // A new instance has an empty memory but the same database.
  resetRateLimits();
  assert.equal((await rateLimit('u1', T0 + 1)).ok, false);
});

test('if the database fails, the in-memory limit takes over', async () => {
  setDriver({ query: async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); }, transaction: async () => { throw new Error('down'); } });
  const warn = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(JSON.parse(line));
  try {
    for (let i = 0; i < MAX_REQUESTS; i++) assert.equal((await rateLimit('u1', T0)).ok, true);
    assert.equal((await rateLimit('u1', T0)).ok, false);
  } finally {
    console.warn = warn;
  }
  assert.equal(lines[0].event, 'ratelimit.db_failed');
});

test('the daily cleanup removes keys idle for longer than the window', async () => {
  await rateLimit('old', Date.now() - WINDOW_MS - 60_000);
  await rateLimit('new', Date.now());
  assert.equal(await pruneRateLimits(WINDOW_MS), 1);
  assert.deepEqual((await pg.query('SELECT key FROM rate_limits')).rows, [{ key: 'new' }]);
});

test('IP addresses are only stored as a hash', async () => {
  const request = new Request('http://localhost/', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
  const key = ipKey('shared:', request);
  assert.match(key, /^shared:[\w-]{22}$/);
  assert.ok(!key.includes('203.0.113.7'));
  assert.equal(key, ipKey('shared:', new Request('http://localhost/', { headers: { 'x-forwarded-for': '203.0.113.7' } })));
  assert.notEqual(key, ipKey('shared:', new Request('http://localhost/', { headers: { 'x-forwarded-for': '203.0.113.8' } })));
});
