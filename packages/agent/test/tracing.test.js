import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';

// A real trace sent to a stand-in Langfuse server: checks the spans reach the OpenTelemetry
// endpoint with the session, the generation's model and usage, and the tool span.
test('startTrace sends the chat trace to Langfuse over OpenTelemetry', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const body = req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw;
      received.push({ path: req.url, auth: req.headers.authorization, body: body.toString('latin1') });
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
  process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const { startTrace, flushTraces } = await import('../src/langfuse.js');
    const trace = startTrace('chat', { sessionId: 'conv-123', input: [{ role: 'user', content: 'Hi' }] });
    assert.match(trace.traceId, /^[0-9a-f]{32}$/);
    const generation = trace.startObservation('reply', { model: 'claude-sonnet-5-5', input: 'Hi' }, { asType: 'generation' });
    generation.update({ output: 'Hello', usageDetails: { input: 3, output: 2 } }).end();
    trace.startObservation('tool search_docs', { input: { query: 'privacy' } }, { asType: 'tool' }).update({ output: 'ok' }).end();
    trace.update({ output: 'Hello' });
    trace.end();
    await flushTraces();

    const sent = received.filter((r) => r.path.includes('/otel/'));
    assert.ok(sent.length > 0, 'no spans reached the OpenTelemetry endpoint');
    assert.equal(sent[0].auth, `Basic ${Buffer.from('pk-lf-test:sk-lf-test').toString('base64')}`);
    const all = sent.map((r) => r.body).join('\n');
    for (const text of ['chat', 'reply', 'tool search_docs', 'conv-123', 'claude-sonnet-5-5', trace.traceId]) {
      assert.ok(all.includes(text), `"${text}" missing from the exported spans`);
    }
  } finally {
    server.close();
  }
});
