import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setDriver, saveConversation, getMessages } from '../lib/db.js';
import { PATCH } from '../api/contact.js';

let alice;
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
});

const skip = (token, body) => PATCH(new Request('http://localhost/api/contact', {
  method: 'PATCH',
  headers: { host: 'localhost', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));

test('Not now needs a signed-in user', async () => {
  assert.equal((await skip(null, { conversationId: 'c1', position: 1 })).status, 401);
});

test('Not now refuses a body that points at no saved card', async () => {
  assert.equal((await skip(alice, 'not json')).status, 400);
  assert.equal((await skip(alice, { conversationId: 'bad id!', position: 1 })).status, 400);
  assert.equal((await skip(alice, { conversationId: 'c1', position: -1 })).status, 400);
  assert.equal((await skip(alice, { conversationId: 'c1', position: '1' })).status, 400);
});

test('Not now saves the card as skipped, so it stays a note after a reload', async () => {
  await saveConversation('user_alice', 'c1', 'Help', [
    { role: 'user', content: 'Can I talk to a person?' },
    { role: 'assistant', content: 'Add your email in the card.', contact: { summary: 'Their link broke.', sent: false } },
  ]);
  assert.equal((await skip(alice, { conversationId: 'c1', position: 1 })).status, 204);
  assert.deepEqual((await getMessages('user_alice', 'c1'))[1].contact, { summary: 'Their link broke.', sent: false, skipped: true });
});

function signJwt(privateKey, claims) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now, nbf: now - 5, exp: now + 300, ...claims })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}
