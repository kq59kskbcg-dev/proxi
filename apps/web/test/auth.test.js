import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { requireUser, setVerifier } from '../lib/auth.js';
import { useTestSignIn } from './helpers/auth.js';

const ENV = ['CLERK_SECRET_KEY', 'CLERK_JWT_KEY', 'CLERK_AUTHORIZED_PARTIES'];
beforeEach(() => { for (const k of ENV) delete process.env[k]; setVerifier(null); });
after(() => setVerifier(null));

const request = (headers = {}) => new Request('http://localhost/api/x', { headers });

test('fails closed when Clerk is not configured', async () => {
  assert.deepEqual(await requireUser(request({ authorization: 'Bearer anything' })), { error: 'Sign-in is not set up yet.', status: 503 });
  process.env.CLERK_SECRET_KEY = '   ';
  assert.equal((await requireUser(request({ authorization: 'Bearer anything' }))).status, 503);
});

test('a request without a token is asked to sign in', async () => {
  useTestSignIn();
  assert.deepEqual(await requireUser(request({ host: 'localhost' })), { error: 'Please sign in.', status: 401, reason: 'no-token' });
});

test('a valid token gives the user ID', async () => {
  const sign = useTestSignIn();
  assert.deepEqual(await requireUser(request({ host: 'localhost', authorization: `Bearer ${sign({ sub: 'user_1' })}` })), { userId: 'user_1' });
});

test("a rejected token reports Clerk's reason, but only when it's a plain reason code", async () => {
  useTestSignIn();
  const reject = (reason) => setVerifier(async () => { throw Object.assign(new Error('secret detail'), { reason }); });
  reject('token-expired');
  assert.deepEqual(await requireUser(request({ authorization: 'Bearer t' })),
    { error: 'Your session has expired. Please sign in again.', status: 401, reason: 'token-expired' });
  for (const odd of ['Token <script>', 'x'.repeat(61), undefined, 42, 'has spaces']) {
    reject(odd);
    assert.equal((await requireUser(request({ authorization: 'Bearer t' }))).reason, 'token-rejected');
  }
});

test('tokens are only accepted from this site: host or forwarded host', async () => {
  const sign = useTestSignIn();
  const token = sign({ sub: 'user_1', azp: 'https://app.example' });
  const auth = { authorization: `Bearer ${token}` };
  assert.equal((await requireUser(request({ ...auth, host: 'app.example' }))).userId, 'user_1');
  assert.equal((await requireUser(request({ ...auth, host: 'internal', 'x-forwarded-host': 'app.example' }))).userId, 'user_1');
  const other = await requireUser(request({ ...auth, host: 'other.example' }));
  assert.equal(other.status, 401);
  assert.equal(other.reason, 'token-invalid-authorized-parties');
});

test('CLERK_AUTHORIZED_PARTIES, when set, replaces the host check', async () => {
  let seen;
  setVerifier(async (token, options) => { seen = options.authorizedParties; return { sub: 'user_1' }; });
  process.env.CLERK_JWT_KEY = 'k';
  process.env.CLERK_AUTHORIZED_PARTIES = ' https://a.example, https://b.example ,';
  await requireUser(request({ authorization: 'Bearer t', host: 'evil.example' }));
  assert.deepEqual(seen, ['https://a.example', 'https://b.example']);

  delete process.env.CLERK_AUTHORIZED_PARTIES;
  await requireUser(request({ authorization: 'Bearer t', host: 'a.example', 'x-forwarded-host': 'a.example, b.example' }));
  assert.deepEqual(seen, ['https://a.example', 'https://b.example']);
});
