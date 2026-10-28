import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

const requests = [];
let reply;
let fake;
let client;

before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply()));
    });
  });
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const { createServer } = await import('../lib/server.js');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
});

after(async () => {
  await client.close();
  fake.close();
});

beforeEach(() => { requests.length = 0; });

const message = (content, stop_reason = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason,
  stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 },
});

test('web_search is offered with a description that says when to use it', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'web_search');
  assert.ok(tool);
  assert.match(tool.description, /current or recent/);
  assert.equal(tool.annotations.readOnlyHint, true);
});

test('web_search asks Claude with web search on and returns the cited pages', async () => {
  reply = () => message([
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'mintlify pricing' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
      { type: 'web_search_result', url: 'https://example.com/pricing', title: 'Pricing', encrypted_content: 'x', page_age: null },
    ] },
    { type: 'text', text: 'The Pro plan costs $150 a month.', citations: [
      { type: 'web_search_result_location', url: 'https://example.com/pricing', title: 'Pricing', cited_text: 'Pro: $150/month', encrypted_index: 'y' },
    ] },
  ]);
  const result = await client.callTool({ name: 'web_search', arguments: { query: 'How much is Mintlify Pro?' } });
  assert.notEqual(result.isError, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'claude-sonnet-5-5');
  assert.deepEqual(requests[0].tools, [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }]);
  assert.equal(requests[0].messages[0].content, 'How much is Mintlify Pro?');
  assert.equal(result.content[0].text, 'The Pro plan costs $150 a month.');
  assert.deepEqual(result.content[1].resource, { uri: 'https://example.com/pricing', mimeType: 'text/plain', text: 'Pro: $150/month', _meta: { title: 'Pricing' } });
});

test('with nothing cited, the pages found are returned as sources', async () => {
  reply = () => message([
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
      { type: 'web_search_result', url: 'https://example.com/a', title: 'Page A', encrypted_content: 'x', page_age: null },
    ] },
    { type: 'text', text: "I couldn't find reliable information." },
  ]);
  const result = await client.callTool({ name: 'web_search', arguments: { query: 'something obscure' } });
  assert.equal(result.structuredContent.sources[0].url, 'https://example.com/a');
  assert.equal(result.structuredContent.sources[0].text, 'Page A');
});

test('a paused search is continued, and a refusal becomes a clear error', async () => {
  let n = 0;
  reply = () => (++n === 1
    ? message([{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } }], 'pause_turn')
    : message([{ type: 'text', text: 'Done.' }]));
  const paused = await client.callTool({ name: 'web_search', arguments: { query: 'q' } });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages[1].role, 'assistant');
  assert.equal(paused.content[0].text, 'Done.');

  reply = () => message([], 'refusal');
  const refused = await client.callTool({ name: 'web_search', arguments: { query: 'q' } });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /couldn't be done/);
});
