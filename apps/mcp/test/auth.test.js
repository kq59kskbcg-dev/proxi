import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../lib/server.js';

const saved = process.env.MCP_TOKEN;
beforeEach(() => { process.env.MCP_TOKEN = 'right-token'; });
afterEach(() => {
  if (saved === undefined) delete process.env.MCP_TOKEN;
  else process.env.MCP_TOKEN = saved;
});

function listTools(authorization) {
  return handler.fetch(new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }));
}

test('refuses a request without a token', async () => {
  const response = await listTools();
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), 'Bearer');
  assert.deepEqual(await response.json(), { error: 'Unauthorized.' });
});

test('refuses a wrong token, of the same or a different length', async () => {
  for (const token of ['wrong-token', 'x', 'right-token-plus']) {
    const response = await listTools(`Bearer ${token}`);
    assert.equal(response.status, 401, token);
    assert.match(response.headers.get('content-type'), /json/);
  }
});

test('refuses the right token without the Bearer scheme', async () => {
  assert.equal((await listTools('right-token')).status, 401);
});

test('answers with the right token', async () => {
  const response = await listTools('Bearer right-token');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"get_status"/);
});

test('trims MCP_TOKEN, so a pasted line break still matches', async () => {
  process.env.MCP_TOKEN = ' right-token\n';
  assert.equal((await listTools('Bearer right-token')).status, 200);
});

test('fails closed with 503 when MCP_TOKEN is not set', async () => {
  for (const value of [undefined, '', '   ']) {
    if (value === undefined) delete process.env.MCP_TOKEN;
    else process.env.MCP_TOKEN = value;
    const response = await listTools('Bearer ');
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not set up/);
    assert.equal((await listTools('Bearer anything')).status, 503);
  }
});

test('also guards GET and DELETE', async () => {
  for (const method of ['GET', 'DELETE']) {
    const response = await handler.fetch(new Request('http://localhost/mcp', { method, headers: { accept: 'text/event-stream' } }));
    assert.equal(response.status, 401, method);
  }
});
