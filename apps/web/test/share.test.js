import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setDriver, saveConversation, deleteConversation, listConversations } from '../lib/db.js';
import { POST, DELETE } from '../api/share.js';
import { GET } from '../api/shared.js';

let alice, bob;
before(() => {
  const pg = new PGlite();
  setDriver({
    query: async (text, params) => (await pg.query(text, params)).rows,
    transaction: (steps) => pg.transaction(async (tx) => {
      for (const [text, params] of steps) await tx.query(text, params);
    }),
  });
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.CLERK_JWT_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
  alice = signJwt(keys.privateKey, { sub: 'user_alice', azp: 'https://localhost' });
  bob = signJwt(keys.privateKey, { sub: 'user_bob', azp: 'https://localhost' });
});

const share = (token, id) => POST(new Request('http://localhost/api/share', {
  method: 'POST',
  headers: { host: 'localhost', 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ id }),
}));
const unshare = (token, id) => DELETE(new Request(`http://localhost/api/share?id=${id}`, {
  method: 'DELETE', headers: { host: 'localhost', authorization: `Bearer ${token}` },
}));
const view = (shareId) => GET(new Request(`http://localhost/api/shared?id=${shareId}`, { headers: { 'x-forwarded-for': '203.0.113.7' } }));

test('sharing needs a signed-in user', async () => {
  const res = await POST(new Request('http://localhost/api/share', { method: 'POST', headers: { host: 'localhost' }, body: '{"id":"c1"}' }));
  assert.equal(res.status, 401);
});

test('a shared chat is public, live and anonymous', async () => {
  await saveConversation('user_alice', 'chat-1', 'Trip plans', [
    { role: 'user', content: 'Plan a trip, mail me at [EMAIL]', attachments: [{ kind: 'pdf' }] },
    { role: 'assistant', content: 'Here is a plan.', model: 'claude-haiku-5-5', traceId: 't1' },
  ]);
  const res = await share(alice, 'chat-1');
  assert.equal(res.status, 200);
  const { shareId } = await res.json();
  assert.match(shareId, /^[\w-]{22}$/);

  // Sharing again keeps the same link, and the list shows it.
  assert.equal((await (await share(alice, 'chat-1')).json()).shareId, shareId);
  assert.equal((await listConversations('user_alice'))[0].shareId, shareId);

  const page = await view(shareId);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  const chat = await page.json();
  assert.equal(chat.title, 'Trip plans');
  assert.deepEqual(chat.messages, [
    { role: 'user', content: 'Plan a trip, mail me at [EMAIL]', attachments: [{ kind: 'pdf' }] },
    { role: 'assistant', content: 'Here is a plan.', attachments: null },
  ]);
  assert.ok(!JSON.stringify(chat).includes('user_alice'));
  assert.ok(!JSON.stringify(chat).includes('chat-1'));

  // Live: later messages show up, and the link survives the save.
  await saveConversation('user_alice', 'chat-1', 'Trip plans', [
    { role: 'user', content: 'Plan a trip' }, { role: 'assistant', content: 'Here is a plan.' },
    { role: 'user', content: 'Cheaper?' }, { role: 'assistant', content: 'Take the train.' },
  ]);
  assert.equal((await (await view(shareId)).json()).messages.length, 4);
});

test("nobody can share or unshare someone else's chat", async () => {
  await saveConversation('user_alice', 'chat-2', 'Private', [{ role: 'user', content: 'Hi' }]);
  assert.equal((await share(bob, 'chat-2')).status, 404);
  const { shareId } = await (await share(alice, 'chat-2')).json();
  assert.equal((await unshare(bob, 'chat-2')).status, 204);
  assert.equal((await view(shareId)).status, 200);
});

test('stopping sharing or deleting the chat kills the link', async () => {
  await saveConversation('user_alice', 'chat-3', 'Soon gone', [{ role: 'user', content: 'Hi' }]);
  const first = (await (await share(alice, 'chat-3')).json()).shareId;
  assert.equal((await unshare(alice, 'chat-3')).status, 204);
  assert.equal((await view(first)).status, 404);

  // Sharing again makes a new link; the old one stays dead.
  const second = (await (await share(alice, 'chat-3')).json()).shareId;
  assert.notEqual(second, first);
  await deleteConversation('user_alice', 'chat-3');
  assert.equal((await view(second)).status, 404);
});

test('malformed or unknown links are not found', async () => {
  assert.equal((await view('short')).status, 404);
  assert.equal((await view('AAAAAAAAAAAAAAAAAAAAAA')).status, 404);
  assert.equal((await share(alice, 'no-such-chat')).status, 404);
  assert.equal((await share(alice, '../etc')).status, 400);
});

function signJwt(privateKey, claims) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now, nbf: now - 5, exp: now + 300, ...claims })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}
