import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../lib/server.js';
import { resetDocsCache, parsePages, tokens } from '../lib/mintlify.js';

const calls = [];
let reply;
let fake;
let client;

const FILE = `# Search the web
Source: https://proxi.mintlify.site/tools/web-search

How Proxi looks up current information on the web.

Proxi uses the web_search tool when an answer depends on current or changing information, such as news, prices, releases or events.

## Privacy

Your search query is redacted like your messages.

# Security
Source: https://proxi.mintlify.site/security

How Proxi protects your data.

## Encryption

Traffic uses HTTPS, and stored data is encrypted, with AES-256 for chats and traces.

## Reporting a problem

Email us if you find a security problem.

# Your privacy
Source: https://proxi.mintlify.site/your-privacy

Short.
`;

before(async () => {
  fake = http.createServer((req, res) => {
    calls.push(req.url);
    const [status, body] = reply(req.url);
    res.writeHead(status, { 'content-type': 'text/plain' });
    res.end(body);
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  process.env.MINTLIFY_DOCS_URL = `http://127.0.0.1:${fake.address().port}`;

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
  resetDocsCache();
  reply = () => [200, FILE];
});

const search = (query, limit) => client.callTool({ name: 'search_docs', arguments: { query, ...(limit ? { limit } : {}) } });

test('lists search_docs with a query parameter', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'search_docs');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['query']);
});

test('needs no API key, and reads the published llms-full.txt', async () => {
  delete process.env.MINTLIFY_API_KEY;
  const result = await search('When does Proxi search the web?');
  assert.notEqual(result.isError, true);
  assert.deepEqual(calls, ['/llms-full.txt']);
});

test('finds the page for a plain question, with its title and link', async () => {
  const web = await search('When does Proxi search the web?');
  assert.equal(web.content[0].type, 'resource');
  assert.equal(web.content[0].resource.uri, 'https://proxi.mintlify.site/tools/web-search');
  assert.equal(web.content[0].resource._meta.title, 'Search the web');
  assert.match(web.content[0].resource.text, /current or changing information/);

  const data = await search('Is my data encrypted?');
  assert.equal(data.structuredContent.results[0].url, 'https://proxi.mintlify.site/security');
  assert.match(data.structuredContent.results[0].text, /AES-256/);
});

test('returns each page once, best page first, up to the limit', async () => {
  const result = await search('security data search', 2);
  const urls = result.structuredContent.results.map((r) => r.url);
  assert.equal(urls.length, 2);
  assert.equal(new Set(urls).size, 2);
});

test('a short section comes with the start of its page', async () => {
  const result = await search('Reporting a problem');
  const hit = result.structuredContent.results[0];
  assert.equal(hit.url, 'https://proxi.mintlify.site/security');
  assert.match(hit.text, /How Proxi protects your data/);
});

test('says so when nothing matches', async () => {
  const result = await search('zebra');
  assert.notEqual(result.isError, true);
  assert.match(result.content[0].text, /No matching docs/);
});

test('keeps the downloaded docs for an hour', async () => {
  await search('encrypted');
  await search('web');
  assert.equal(calls.length, 1);
});

test('uses the last copy of the docs when a refresh fails', async () => {
  await search('encrypted');
  const later = Date.now() + 2 * 60 * 60 * 1000;
  const now = mock.method(Date, 'now', () => later);
  try {
    reply = () => [500, 'boom'];
    const result = await search('encrypted');
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.results[0].url, 'https://proxi.mintlify.site/security');
    assert.equal(calls.length, 2);
  } finally {
    now.mock.restore();
  }
});

test('reports a failed download as a tool error', async () => {
  reply = () => [500, 'boom'];
  const result = await search('privacy');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /HTTP 500/);
});

test('reports a file in an unexpected format as a tool error', async () => {
  reply = () => [200, 'Just some text with no pages in it.'];
  const result = await search('privacy');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unavailable/);
});

test('parsePages reads the title above each Source line, and the text below it', () => {
  const pages = parsePages(FILE);
  assert.deepEqual(pages.map((p) => [p.title, p.url]), [
    ['Search the web', 'https://proxi.mintlify.site/tools/web-search'],
    ['Security', 'https://proxi.mintlify.site/security'],
    ['Your privacy', 'https://proxi.mintlify.site/your-privacy'],
  ]);
  assert.doesNotMatch(pages[0].body, /# Security/);
  assert.match(pages[1].body, /Encryption/);
});

test('tokens drop filler words and match word endings', () => {
  assert.deepEqual(tokens('Is my data encrypted?'), ['data', 'encrypt']);
  assert.deepEqual(tokens('Encryption of chats'), ['encrypt', 'chat']);
});
