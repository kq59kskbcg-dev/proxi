import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { saveConversation, shareConversation } from '../lib/db.js';
import { GET } from '../api/shared.js';
import { MAX_REQUESTS } from '../lib/ratelimit.js';
import { useTestDatabase } from './helpers/db.js';

let pg;
before(() => { pg = useTestDatabase(); });

const SHARE = 'BBBBBBBBBBBBBBBBBBBBBB';
const view = (id, ip = '198.51.100.1') => GET(new Request(`http://localhost/api/shared?id=${id}`, { headers: { 'x-forwarded-for': ip } }));

test('a shared chat is readable without signing in, never cached or indexed', async () => {
  await saveConversation('user_a', 'c1', 'Trip', [{ role: 'user', content: 'Hi' }]);
  await shareConversation('user_a', 'c1', SHARE);
  const res = await view(SHARE);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await res.json()).title, 'Trip');
});

test('unknown and malformed links are not found, with the same headers', async () => {
  for (const id of ['', 'short', 'CCCCCCCCCCCCCCCCCCCCCC']) {
    const res = await view(id);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
});

test('each IP address is rate limited, and only its hash is stored', async () => {
  const ip = '203.0.113.99';
  for (let i = 0; i < MAX_REQUESTS; i++) assert.equal((await view(SHARE, ip)).status, 200);
  assert.equal((await view(SHARE, ip)).status, 429);
  assert.equal((await view(SHARE, '203.0.113.100')).status, 200);
  const keys = (await pg.query('SELECT key FROM rate_limits')).rows.map((r) => r.key);
  assert.ok(keys.every((k) => /^shared:[\w-]{22}$/.test(k)));
  assert.ok(!JSON.stringify(keys).includes('203.0.113'));
});
