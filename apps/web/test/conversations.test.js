import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setDriver, saveConversation, listConversations } from '../lib/db.js';
import { DELETE } from '../api/conversations.js';

let token;
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
  token = signJwt(keys.privateKey, { sub: 'user_conv', azp: 'https://localhost' });
});

const del = (query, auth = `Bearer ${token}`) => DELETE(new Request(`http://localhost/api/conversations${query}`, {
  method: 'DELETE', headers: { host: 'localhost', ...(auth ? { authorization: auth } : {}) },
}));

test('deleting all chats needs a signed-in user', async () => {
  assert.equal((await del('?all=1', null)).status, 401);
});

test('a delete without a chat ID or all=1 is refused and deletes nothing', async () => {
  await saveConversation('user_conv', 'k1', 'Keep me', [{ role: 'user', content: 'Hi' }]);
  assert.equal((await del('')).status, 400);
  assert.equal((await del('?all=true')).status, 400);
  assert.equal((await listConversations('user_conv')).length, 1);
});

test('all=1 deletes every chat of the signed-in user only', async () => {
  await saveConversation('user_conv', 'k2', 'Second', [{ role: 'user', content: 'Hi' }]);
  await saveConversation('user_else', 'k1', 'Not mine', [{ role: 'user', content: 'Hi' }]);
  assert.equal((await del('?all=1')).status, 204);
  assert.deepEqual(await listConversations('user_conv'), []);
  assert.equal((await listConversations('user_else')).length, 1);
});

function signJwt(privateKey, claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({ iat: now - 5, nbf: now - 5, exp: now + 300, ...claims });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
