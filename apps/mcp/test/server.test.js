import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { handler } from '../lib/server.js';

let server;
let client;

before(async () => {
  server = http.createServer(toNodeHandler(handler));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
});

after(async () => {
  await client.close();
  server.close();
});

test('tools/list includes get_status with a description and schema', async () => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'get_status');
  assert.ok(tool);
  assert.match(tool.description, /status/);
  assert.equal(tool.inputSchema.type, 'object');
});

test('tools/call get_status returns a JSON status', async () => {
  const result = await client.callTool({ name: 'get_status', arguments: {} });
  assert.notEqual(result.isError, true);
  const status = JSON.parse(result.content[0].text);
  assert.equal(status.status, 'ok');
  assert.equal(status.service, 'proxi-mcp');
  assert.deepEqual(result.structuredContent, status);
});

test('tools/call with an unknown tool reports an error', async () => {
  const result = await client.callTool({ name: 'nope', arguments: {} }).catch((error) => ({ isError: true, error }));
  assert.equal(result.isError, true);
});

test('answers a plain JSON-RPC tools/list request', async () => {
  const response = await handler.fetch(new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"get_status"/);
});
