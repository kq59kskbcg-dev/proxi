import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { saveConversation, setDriver } from '../lib/db.js';
import { GET, DELETE } from '../api/conversations.js';
import { useTestDatabase } from './helpers/db.js';
import { useTestSignIn } from './helpers/auth.js';

let alice, bob;
before(() => {
  useTestDatabase();
  const sign = useTestSignIn();
  alice = sign({ sub: 'user_alice' });
  bob = sign({ sub: 'user_bob' });
});

const call = (handler, method, query = '', token = alice) => handler(new Request(`http://localhost/api/conversations${query}`, {
  method, headers: { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) },
}));

test('needs a signed-in user', async () => {
  const res = await call(GET, 'GET', '', null);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Please sign in.', code: 'no-token' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await call(DELETE, 'DELETE', '?id=c1', null)).status, 401);
});

test("lists the user's chats and reads one, never another user's", async () => {
  await saveConversation('user_alice', 'c1', 'Lisbon', [{ role: 'user', content: 'Plan a trip' }]);
  await saveConversation('user_bob', 'c2', 'Rome', [{ role: 'user', content: 'Bob only' }]);

  const list = await call(GET, 'GET');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await list.json()).conversations.map((c) => c.title), ['Lisbon']);

  const one = await (await call(GET, 'GET', '?id=c1')).json();
  assert.deepEqual(one.messages.map((m) => m.content), ['Plan a trip']);
  assert.deepEqual((await (await call(GET, 'GET', '?id=c2')).json()).messages, []);
});

test('rejects malformed chat IDs', async () => {
  assert.equal((await call(GET, 'GET', '?id=../x')).status, 400);
  assert.equal((await call(DELETE, 'DELETE', '?id=')).status, 400);
  assert.equal((await call(DELETE, 'DELETE', '')).status, 400);
});

test("deletes the user's own chat only", async () => {
  await saveConversation('user_alice', 'c3', 'Gone soon', [{ role: 'user', content: 'Hi' }]);
  assert.equal((await call(DELETE, 'DELETE', '?id=c3', bob)).status, 204);
  assert.equal((await (await call(GET, 'GET', '?id=c3')).json()).messages.length, 1);
  assert.equal((await call(DELETE, 'DELETE', '?id=c3')).status, 204);
  assert.equal((await (await call(GET, 'GET', '?id=c3')).json()).messages.length, 0);
});

test('a database error gives a 500 with a safe diagnosis and a structured log line', async () => {
  const lines = [];
  const error = console.error;
  console.error = (line) => lines.push(JSON.parse(line));
  setDriver({ query: async () => { throw Object.assign(new Error('password=hunter2'), { code: '08006' }); }, transaction: async () => {} });
  try {
    const res = await call(GET, 'GET');
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Could not load your chats.', code: '08006', kind: 'Error' });
  } finally {
    console.error = error;
    useTestDatabase();
  }
  assert.ok(lines.some((l) => l.event === 'conversations.get_failed' && l.code === '08006'));
  assert.ok(!JSON.stringify(lines).includes('hunter2'));
});

test('without a database, chat history is not set up', async () => {
  setDriver(null);
  const saved = [process.env.DATABASE_URL, process.env.POSTGRES_URL];
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
  try {
    assert.equal((await call(GET, 'GET')).status, 503);
  } finally {
    [process.env.DATABASE_URL, process.env.POSTGRES_URL] = saved;
    if (saved[0] === undefined) delete process.env.DATABASE_URL;
    if (saved[1] === undefined) delete process.env.POSTGRES_URL;
    useTestDatabase();
  }
});
