import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { setDriver } from '../lib/db.js';
import { GET } from '../api/cleanup.js';

before(() => {
  const pg = new PGlite();
  setDriver({
    query: async (text, params) => (await pg.query(text, params)).rows,
    transaction: (steps) => pg.transaction(async (tx) => {
      for (const [text, params] of steps) await tx.query(text, params);
    }),
  });
});

const call = (auth) => GET(new Request('http://localhost/api/cleanup', { headers: auth ? { authorization: auth } : {} }));

test('cleanup refuses to run without CRON_SECRET configured', async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await call('Bearer anything')).status, 401);
});

test('cleanup refuses requests without the right secret', async () => {
  process.env.CRON_SECRET = 'cron-test-secret';
  assert.equal((await call()).status, 401);
  assert.equal((await call('Bearer wrong')).status, 401);
});

test('cleanup runs with the right secret and reports what it deleted', async () => {
  process.env.CRON_SECRET = 'cron-test-secret';
  const res = await call('Bearer cron-test-secret');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: 0 });
});
