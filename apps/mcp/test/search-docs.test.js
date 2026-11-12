import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../lib/server.js';
import { indexJson, sectionsOf } from '../scripts/build-docs-index.js';
import { tokens, urlOf } from '../lib/docs-search.js';

let client;

before(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
});

after(async () => {
  await client.close();
});

beforeEach(() => {
  delete process.env.MINTLIFY_DOCS_URL;
});

const search = (query, limit) => client.callTool({ name: 'search_docs', arguments: { query, ...(limit ? { limit } : {}) } });

test('the committed docs index is up to date with apps/docs', () => {
  const committed = readFileSync(new URL('../lib/docs-index.json', import.meta.url), 'utf8');
  assert.equal(committed, indexJson(), 'run `npm run build-docs-index` in apps/mcp and commit the result');
});

test('splits a page into sections at its headings', () => {
  const page = '---\ntitle: "Memory"\ndescription: "What Proxi remembers."\n---\n\nIntro text.\n\n## Limits\n\nYou can save 50.\n\n<Update label="May 1">\n  A change.\n</Update>\n';
  assert.deepEqual(sectionsOf(page, 'settings/memory').map((s) => [s.title, s.heading, s.text]), [
    ['Memory', '', 'What Proxi remembers.\n\nIntro text.'],
    ['Memory', 'Limits', 'You can save 50.'],
    ['Memory', 'May 1', 'A change.'],
  ]);
});

test('lists search_docs with a query parameter', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'search_docs');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['query']);
});

test('finds the page that answers the question, with title, link and text', async () => {
  const result = await search('Is my data encrypted?', 3);
  assert.notEqual(result.isError, true);
  const hits = result.structuredContent.results;
  assert.ok(hits.length >= 1 && hits.length <= 3);
  assert.ok(hits.some((hit) => hit.url === 'https://proxi.mintlify.app/security'));
  assert.equal(result.content[0].type, 'resource');
  assert.equal(result.content[0].resource.uri, hits[0].url);
  assert.equal(result.content[0].resource._meta.title, hits[0].title);
  assert.ok(hits[0].text.length > 0);
});

test('finds pages by plural and verb forms', async () => {
  const hits = (await search('suggested replies')).structuredContent.results;
  assert.equal(hits[0].url, 'https://proxi.mintlify.app/chats/send-messages');
});

test('ranks the changelog below the pages that explain a feature', async () => {
  const hits = (await search('suggested replies', 3)).structuredContent.results;
  assert.notEqual(hits[0].url, 'https://proxi.mintlify.app/release-notes');
});

test('says so when nothing matches', async () => {
  for (const query of ['qqzzxx', 'what is the']) {
    const result = await search(query);
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /No matching docs/);
  }
});

test('links use the docs site address from the environment when it is set', () => {
  assert.equal(urlOf('privacy'), 'https://proxi.mintlify.app/privacy');
  assert.equal(urlOf('index'), 'https://proxi.mintlify.app/');
  process.env.MINTLIFY_DOCS_URL = 'https://docs.example.com/';
  assert.equal(urlOf('privacy'), 'https://docs.example.com/privacy');
});

test('tokens drops filler words and trims plurals', () => {
  assert.deepEqual(tokens('How are my chats kept?'), ['chat', 'kept']);
});
