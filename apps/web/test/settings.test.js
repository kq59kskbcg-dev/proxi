import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setDriver } from '../lib/db.js';
import { GET, PUT } from '../api/settings.js';

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
  token = signJwt(keys.privateKey, { sub: 'user_settings', azp: 'https://localhost' });
});

const request = (method, body, auth = `Bearer ${token}`) => new Request('http://localhost/api/settings', {
  method,
  headers: { host: 'localhost', 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('settings need a signed-in user', async () => {
  assert.equal((await GET(request('GET', undefined, null))).status, 401);
});

test('settings start at 30 days and list the choices', async () => {
  const res = await GET(request('GET'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { chatRetentionDays: 30, retentionOptions: [7, 30, 90] });
});

test('a valid choice is saved, anything else is refused', async () => {
  const saved = await PUT(request('PUT', { chatRetentionDays: 7 }));
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { chatRetentionDays: 7 });
  assert.equal((await PUT(request('PUT', { chatRetentionDays: 365 }))).status, 400);
  assert.equal((await PUT(request('PUT', { chatRetentionDays: '7' }))).status, 400);
  assert.equal((await (await GET(request('GET'))).json()).chatRetentionDays, 7);
});

function signJwt(privateKey, claims) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now, nbf: now - 5, exp: now + 300, ...claims })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}
