import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../lib/server.js';

const calls = [];
let reply;
let fake;
let client;

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
      const [status, body] = reply(req.url);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  process.env.MINTLIFY_API_URL = `http://127.0.0.1:${fake.address().port}/discovery/v1`;
  process.env.MINTLIFY_DOCS_URL = 'https://proxi.mintlify.site';
  delete process.env.MINTLIFY_DOMAIN;

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
});

after(async () => {
  await client.close();
  fake.close();
});

beforeEach(() => {
  calls.length = 0;
  process.env.MINTLIFY_API_KEY = 'mint_dsc_test';
});

const longText = 'Proxi masks card numbers, IBANs, emails and phone numbers before anything reaches the model. '.repeat(3);

test('lists search_docs with a query parameter', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'search_docs');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['query']);
});

test('returns Mintlify hits as resources with title and link', async () => {
  reply = () => [200, [
    { path: 'privacy', content: longText, metadata: { title: 'Privacy' } },
    { path: '/security', content: longText, metadata: {} },
  ]];
  const result = await client.callTool({ name: 'search_docs', arguments: { query: 'what is masked', limit: 3 } });

  assert.equal(calls[0].url, '/discovery/v1/search/proxi.mintlify.site');
  assert.equal(calls[0].auth, 'Bearer mint_dsc_test');
  assert.deepEqual(calls[0].body, { query: 'what is masked', pageSize: 3 });

  assert.notEqual(result.isError, true);
  assert.equal(result.content.length, 2);
  assert.equal(result.content[0].type, 'resource');
  assert.equal(result.content[0].resource.uri, 'https://proxi.mintlify.site/privacy');
  assert.equal(result.content[0].resource._meta.title, 'Privacy');
  assert.equal(result.structuredContent.results[1].url, 'https://proxi.mintlify.site/security');
  assert.equal(result.structuredContent.results[1].title, 'security');
});

test('accepts a response wrapped in results', async () => {
  reply = () => [200, { results: [{ path: 'features', content: longText, metadata: { title: 'Features' } }] }];
  const result = await client.callTool({ name: 'search_docs', arguments: { query: 'features' } });
  assert.equal(result.structuredContent.results[0].title, 'Features');
});

test('fetches the full page when the snippet is short', async () => {
  reply = (url) => url.includes('/page/')
    ? [200, { path: 'privacy', content: longText }]
    : [200, [{ path: 'privacy', content: 'Short.', metadata: { title: 'Privacy' } }]];
  const result = await client.callTool({ name: 'search_docs', arguments: { query: 'privacy' } });
  assert.equal(calls[1].url, '/discovery/v1/page/proxi.mintlify.site');
  assert.deepEqual(calls[1].body, { path: 'privacy' });
  assert.equal(result.structuredContent.results[0].text, longText);
});

test('says so when nothing matches', async () => {
  reply = () => [200, []];
  const result = await client.callTool({ name: 'search_docs', arguments: { query: 'unrelated' } });
  assert.notEqual(result.isError, true);
  assert.match(result.content[0].text, /No matching docs/);
});

test('reports a missing key as a tool error', async () => {
  delete process.env.MINTLIFY_API_KEY;
  const result = await client.callTool({ name: 'search_docs', arguments: { query: 'privacy' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not set up/);
  assert.equal(calls.length, 0);
});

test('reports Mintlify failures as a tool error', async () => {
  reply = () => [500, { error: 'boom' }];
  const result = await client.callTool({ name: 'search_docs', arguments: { query: 'privacy' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 500/);
});
