import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { addMemory, listMemories, MEMORY_LIMIT } from '../lib/db.js';
import { GET, DELETE } from '../api/memories.js';
import { useTestDatabase } from './helpers/db.js';
import { useTestSignIn } from './helpers/auth.js';

let alice, bob;
before(() => {
  useTestDatabase();
  const sign = useTestSignIn();
  alice = sign({ sub: 'user_alice' });
  bob = sign({ sub: 'user_bob' });
});

const call = (handler, method, query = '', token = alice) => handler(new Request(`http://localhost/api/memories${query}`, {
  method, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) },
}));

test('needs a signed-in user', async () => {
  assert.equal((await call(GET, 'GET', '', null)).status, 401);
  assert.equal((await call(DELETE, 'DELETE', '?id=m1', null)).status, 401);
});

test("lists the user's memories with the limit", async () => {
  await addMemory('user_alice', 'm1', 'Likes trains');
  await addMemory('user_bob', 'm2', 'Bob only');
  const res = await call(GET, 'GET');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.limit, MEMORY_LIMIT);
  assert.deepEqual(body.memories.map((m) => m.content), ['Likes trains']);
});

test("deletes the user's own memory only, and rejects malformed IDs", async () => {
  assert.deepEqual(await (await call(DELETE, 'DELETE', '?id=m1', bob)).json(), { ok: true });
  assert.equal((await listMemories('user_alice')).length, 1);
  assert.deepEqual(await (await call(DELETE, 'DELETE', '?id=m1')).json(), { ok: true });
  assert.equal((await listMemories('user_alice')).length, 0);
  assert.equal((await call(DELETE, 'DELETE', '?id=a%20b')).status, 400);
  assert.equal((await call(DELETE, 'DELETE', '')).status, 400);
});
