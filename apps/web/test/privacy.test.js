import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setDriver, recordRedactions, getRedactionCounts, saveConversation, deleteAccountData } from '../lib/db.js';
import { summarizeRedactions } from '../lib/privacy.js';
import { privacyView, summaryLine, sinceLabel } from '../ui/privacy.js';
import { GET } from '../api/privacy.js';

let pg;
let token;
before(() => {
  pg = new PGlite();
  setDriver({
    query: async (text, params) => (await pg.query(text, params)).rows,
    transaction: (steps) => pg.transaction(async (tx) => {
      for (const [text, params] of steps) await tx.query(text, params);
    }),
  });
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.CLERK_JWT_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
  token = signJwt(keys.privateKey, { sub: 'user_privacy', azp: 'https://localhost' });
});

const at = (conversationId, position, content) => ({ conversationId, position, content });
const request = (auth = `Bearer ${token}`) => new Request('http://localhost/api/privacy', {
  headers: { host: 'localhost', ...(auth ? { authorization: auth } : {}) },
});

test('the privacy summary needs a signed-in user', async () => {
  assert.equal((await GET(request(null))).status, 401);
});

test('a new user has nothing counted', async () => {
  const res = await GET(request());
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.since, null);
  assert.equal(data.all.total, 0);
  assert.deepEqual(data.all.byType, { EMAIL: 0, PHONE: 0, CARD: 0, IBAN: 0 });
});

test('counts add up by type and day, and only counts are stored', async () => {
  await recordRedactions('user_privacy', { EMAIL: 2, PHONE: 1 }, at('c1', 0, 'Mail [EMAIL] or [EMAIL], call [PHONE]'));
  await recordRedactions('user_privacy', { EMAIL: 1 }, at('c2', 0, 'Write to [EMAIL]'));
  await recordRedactions('user_privacy', {}, at('c3', 0, 'Nothing here'));
  const rows = (await pg.query('SELECT * FROM redaction_counts ORDER BY type')).rows;
  assert.deepEqual(rows.map((r) => [r.user_id, r.type, r.count]), [['user_privacy', 'EMAIL', 3], ['user_privacy', 'PHONE', 1]]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['count', 'day', 'type', 'user_id']);

  const data = await (await GET(request())).json();
  assert.equal(data.month.total, 4);
  assert.equal(data.all.total, 4);
  assert.deepEqual(data.month.byType, { EMAIL: 3, PHONE: 1, CARD: 0, IBAN: 0 });
  assert.equal(data.since, data.today);
});

test('a message the chat already saved is not counted again, an edited one is', async () => {
  const content = 'My card ends 4242, card [CARD]';
  await saveConversation('user_privacy', 'c4', 'Card', [{ role: 'user', content }]);
  await recordRedactions('user_privacy', { CARD: 1 }, at('c4', 0, content));
  assert.equal((await getRedactionCounts('user_privacy')).rows.find((r) => r.type === 'CARD'), undefined);
  await recordRedactions('user_privacy', { CARD: 1 }, at('c4', 0, 'Another card [CARD]'));
  assert.equal((await getRedactionCounts('user_privacy')).rows.find((r) => r.type === 'CARD').count, 1);
});

test('deleting an account deletes its counts, and other users keep theirs', async () => {
  await recordRedactions('user_other', { IBAN: 1 }, at('c1', 0, 'Pay [IBAN]'));
  await deleteAccountData('user_privacy');
  assert.equal((await getRedactionCounts('user_privacy')).rows.length, 0);
  assert.equal((await getRedactionCounts('user_other')).rows.length, 1);
});

test('the summary groups weeks of this month and up to six months', () => {
  const s = summarizeRedactions({
    since: '2026-03-14',
    today: '2026-11-20',
    rows: [
      { day: '2026-03-01', type: 'EMAIL', count: 5 },
      { day: '2026-07-01', type: 'PHONE', count: 2 },
      { day: '2026-11-03', type: 'EMAIL', count: 4 },
      { day: '2026-11-15', type: 'IBAN', count: 1 },
    ],
  });
  assert.equal(s.all.total, 12);
  assert.equal(s.month.total, 5);
  assert.deepEqual(s.month.bars.map((b) => b.count), [4, 0, 1, 0, 0]);
  assert.deepEqual(s.all.bars.map((b) => b.label), ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  assert.deepEqual(s.all.bars.map((b) => b.count), [0, 2, 0, 0, 0, 5]);
  // A user who started this month sees one month, and February has four weeks.
  const feb = summarizeRedactions({ since: '2027-02-02', today: '2027-02-10', rows: [] });
  assert.equal(feb.all.bars.length, 1);
  assert.equal(feb.month.bars.length, 4);
});

test('the page shows the headline, the types by count and the summary line', () => {
  const summary = summarizeRedactions({
    since: '2026-11-03',
    today: '2026-11-20',
    rows: [{ day: '2026-11-03', type: 'EMAIL', count: 40 }, { day: '2026-11-04', type: 'PHONE', count: 2 }],
  });
  const v = privacyView(summary, 'month', summary.today);
  assert.equal(v.count, '42 personal details');
  assert.equal(v.when, 'protected this month');
  assert.equal(v.line, 'Proxi removed them from your messages before sending them to Claude. Mostly emails and phone numbers.');
  assert.deepEqual(v.types.map((t) => [t.label, t.n, t.width]), [['Emails', 40, '100%'], ['Phone numbers', 2, '5%'], ['Card numbers', 0, '0%'], ['IBANs', 0, '0%']]);
  assert.equal(privacyView(summary, 'all', summary.today).when, 'protected since November 3');
});

test('the summary line covers one detail, one type and none', () => {
  assert.equal(summaryLine(0, {}, 'month'), 'Nothing removed this month.');
  assert.equal(summaryLine(1, { EMAIL: 1 }, 'month'), 'Proxi removed it from your message before sending it to Claude.');
  assert.match(summaryLine(3, { IBAN: 3, EMAIL: 0 }, 'all'), /All of them were IBANs\.$/);
  assert.equal(sinceLabel('2025-12-01', '2026-11-20'), 'December 1, 2025');
});

function signJwt(privateKey, claims) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now, nbf: now - 5, exp: now + 300, ...claims })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}
