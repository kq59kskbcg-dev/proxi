import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { setDriver } from '../lib/db.js';
import { GET } from '../api/cleanup.js';

let pg;
before(() => {
  pg = new PGlite();
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
  assert.deepEqual(await res.json(), { deleted: 0, orphanTraces: 0 });
});

test('the daily run deletes traces of chats that no longer exist, and keeps the rest', async () => {
  const { saveConversation } = await import('../lib/db.js');
  const { deleteOrphanTraces } = await import('../api/cleanup.js');
  const http = await import('node:http');
  await saveConversation('user_keep', 'kept-chat', 'Kept', [{ role: 'user', content: 'Hi' }]);
  const id = (c) => c.repeat(32);
  const pages = {
    first: { data: [{ traceId: id('a'), sessionId: 'kept-chat' }, { traceId: id('b'), sessionId: 'deleted-chat' }], meta: { cursor: 'second' } },
    second: { data: [{ traceId: id('c'), sessionId: null }], meta: {} },
  };
  const seen = { lists: [], deleted: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/api/public/v2/observations') {
        seen.lists.push(Object.fromEntries(url.searchParams));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(pages[url.searchParams.get('cursor') || 'first']));
      } else if (req.method === 'DELETE' && url.pathname === '/api/public/traces') {
        seen.deleted.push(...JSON.parse(Buffer.concat(chunks)).traceIds);
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"message":"ok"}');
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
  process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const now = Date.parse('2026-11-01T12:00:00Z');
    assert.equal(await deleteOrphanTraces({ now }), 2);
    assert.deepEqual(seen.deleted.sort(), [id('b'), id('c')]);
    assert.equal(seen.lists[0].name, 'chat');
    assert.equal(seen.lists[0].isRootObservation, 'true');
    assert.equal(seen.lists[0].toStartTime, '2026-10-31T12:00:00.000Z');
    assert.equal(seen.lists.length, 2);
  } finally {
    server.close();
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
  }
});

test('a shared link is deleted with its chat when the retention job runs', async () => {
  const { saveConversation, shareConversation, getSharedConversation } = await import('../lib/db.js');
  const query = async (text, params) => (await pg.query(text, params)).rows;
  process.env.CRON_SECRET = 'cron-test-secret';
  await saveConversation('user_old', 'chat-old', 'Old shared chat', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]);
  const shareId = await shareConversation('user_old', 'chat-old', 'x'.repeat(22));
  assert.ok(await getSharedConversation(shareId));
  await query("UPDATE conversations SET updated_at = now() - interval '31 days' WHERE id = 'chat-old'");
  assert.equal((await (await call('Bearer cron-test-secret')).json()).deleted, 1);
  assert.equal(await getSharedConversation(shareId), null);
  assert.equal((await query('SELECT count(*)::int AS n FROM conversations WHERE share_id = $1', [shareId]))[0].n, 0);
});
