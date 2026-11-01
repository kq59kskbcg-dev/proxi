import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setDriver, saveConversation, listConversations } from '../lib/db.js';
import { DELETE, setClerk } from '../api/account.js';

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
  token = signJwt(keys.privateKey, { sub: 'user_acct', azp: 'https://localhost' });
});

const call = (auth = `Bearer ${token}`) => DELETE(new Request('http://localhost/api/account', {
  method: 'DELETE', headers: { host: 'localhost', ...(auth ? { authorization: auth } : {}) },
}));

test('deleting an account needs a signed-in user', async () => {
  assert.equal((await call(null)).status, 401);
});

test('deleting an account is refused when Clerk is not set up for it', async () => {
  delete process.env.CLERK_SECRET_KEY;
  assert.equal((await call()).status, 503);
});

test('deleting an account removes the data and then the Clerk user', async () => {
  process.env.CLERK_SECRET_KEY = 'sk_test_fake';
  const deleted = [];
  setClerk({ users: { deleteUser: async (id) => { deleted.push(id); } } });
  await saveConversation('user_acct', 'c1', 'Hello', [{ role: 'user', content: 'Hi' }]);

  assert.equal((await call()).status, 204);
  assert.deepEqual(deleted, ['user_acct']);
  assert.deepEqual(await listConversations('user_acct'), []);
});

test('the account is kept when deleting the Clerk user fails, so it can be retried', async () => {
  process.env.CLERK_SECRET_KEY = 'sk_test_fake';
  setClerk({ users: { deleteUser: async () => { throw new Error('clerk down'); } } });
  const res = await call();
  assert.equal(res.status, 500);
});

function signJwt(privateKey, claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({ iat: now - 5, nbf: now - 5, exp: now + 300, ...claims });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}
