import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('deleteTraces asks Langfuse to delete real trace IDs, and ignores the rest', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ method: req.method, path: req.url, body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"message":"ok"}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
  process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const { deleteTraces } = await import('../src/langfuse.js');
    const id = 'a'.repeat(32);
    await deleteTraces([id, id, 'not-a-trace', null, '../etc']);
    await deleteTraces([]);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, 'DELETE');
    assert.equal(received[0].path, '/api/public/traces');
    assert.deepEqual(JSON.parse(received[0].body), { traceIds: [id] });
  } finally {
    server.close();
  }
});
