import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const mcpDir = fileURLToPath(new URL('../../mcp/', import.meta.url));
const ready = existsSync(new URL('../../mcp/node_modules/', import.meta.url));

const requests = [];
let script = [];
let fakeClaude;
let fakeMintlify;
let mcpServer;
let token;

before(async () => {
  if (!ready) return;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.CLERK_JWT_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
  token = signJwt(keys.privateKey, { sub: 'user_e2e', azp: 'https://localhost' });

  fakeClaude = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const turn = script.shift()(body);
      for (const [event, data] of turn) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    });
  });
  await listen(fakeClaude);
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fakeClaude.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';

  fakeMintlify = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ path: 'privacy', content: PRIVACY_TEXT, metadata: { title: 'Privacy' } }]));
  });
  await listen(fakeMintlify);

  const port = await freePort();
  mcpServer = spawn(process.execPath, ['server.js'], {
    cwd: mcpDir,
    env: {
      ...process.env,
      PORT: String(port),
      MINTLIFY_API_KEY: 'mint_dsc_test',
      MINTLIFY_API_URL: `http://127.0.0.1:${fakeMintlify.address().port}/discovery/v1`,
      MINTLIFY_DOCS_URL: 'https://proxi.mintlify.site',
    },
  });
  await new Promise((resolve, reject) => {
    mcpServer.stdout.on('data', (chunk) => { if (String(chunk).includes('localhost')) resolve(); });
    mcpServer.on('exit', reject);
  });
  process.env.MCP_URL = `http://127.0.0.1:${port}/mcp`;
});

after(() => {
  fakeClaude?.close();
  fakeMintlify?.close();
  mcpServer?.kill();
});

const PRIVACY_TEXT = 'Card numbers, IBANs, emails and phone numbers are masked before anything reaches the model or the logs.';
const skip = !ready && 'run npm install in apps/mcp first';

async function chat(question, extra = {}) {
  requests.length = 0;
  const { POST } = await import('../api/chat.js');
  const response = await POST(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, host: 'localhost', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'Haiku 5.5', messages: [{ role: 'user', content: question }], ...extra }),
  }));
  assert.equal(response.status, 200);
  return (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
}

test('the agent discovers get_status over MCP and calls it', { skip }, async () => {
  script = [() => toolUseTurn('get_status', {}), (body) => textTurn(`Proxi is up (status: ${statusFrom(body)}).`)];
  const events = await chat('Is the Proxi server up?');

  assert.equal(requests.length, 2);
  const offered = requests[0].tools.find((tool) => tool.name === 'get_status');
  assert.ok(offered, 'get_status was discovered and offered to Claude');
  assert.match(offered.description, /status/);
  assert.equal(offered.input_schema.type, 'object');

  const [assistant, toolTurn] = requests[1].messages.slice(-2);
  assert.equal(assistant.content.find((block) => block.type === 'tool_use').name, 'get_status');
  const result = toolTurn.content[0];
  assert.equal(result.type, 'tool_result');
  assert.equal(result.tool_use_id, 'toolu_1');
  assert.notEqual(result.is_error, true);
  assert.equal(JSON.parse(result.content[0].text).status, 'ok');

  const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
  assert.match(text, /Proxi is up \(status: ok\)/);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).stopReason, 'end_turn');
  const activity = events.find((e) => e.type === 'activity');
  assert.deepEqual(activity, { type: 'activity', label: "Checking Proxi's status", done: "Checked Proxi's status" });
  assert.ok(events.indexOf(activity) < events.findIndex((e) => e.type === 'text'), 'activity is sent before the reply text');
});

test('search_docs results come back citable and the reply cites them', { skip }, async () => {
  script = [
    () => toolUseTurn('search_docs', { query: 'what gets masked' }),
    (body) => citedTextTurn(body),
  ];
  const events = await chat('What does Proxi mask?');

  assert.ok(requests[0].tools.some((tool) => tool.name === 'search_docs'));
  const result = requests[1].messages.at(-1).content[0];
  assert.equal(result.type, 'tool_result');
  const hit = result.content[0];
  assert.equal(hit.type, 'search_result');
  assert.equal(hit.source, 'https://proxi.mintlify.site/privacy');
  assert.equal(hit.title, 'Privacy');
  assert.deepEqual(hit.citations, { enabled: true });
  assert.equal(hit.content[0].text, PRIVACY_TEXT);

  const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
  assert.match(text, /Proxi masks card numbers\. \[\[1\]\]\(https:\/\/proxi\.mintlify\.site\/privacy\)/);
  assert.match(text, /\*\*Sources\*\*\n1\. \[Privacy\]\(https:\/\/proxi\.mintlify\.site\/privacy\)$/);
});

test('a temporary chat is not titled, saved or traced', { skip }, async () => {
  script = [() => textTurn('Sure.')];
  const events = await chat('Help me plan a trip', { conversationId: 'temp-chat-1', temporary: true });
  assert.equal(requests.length, 1, 'only the reply was requested, no title');
  assert.equal(events[0].type, 'start');
  assert.equal(events[0].traceId, null);
  assert.ok(!events.some((e) => e.type === 'title'));
  assert.equal(events.at(-1).type, 'done');
});

function toolUseTurn(name, input) {
  return [
    ['message_start', { type: 'message_start', message: message() }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name, input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
}

function textTurn(reply) {
  return [
    ['message_start', { type: 'message_start', message: message() }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
}

function citedTextTurn(body) {
  const hit = body.messages.at(-1).content[0].content[0];
  const citation = {
    type: 'search_result_location', source: hit.source, title: hit.title, cited_text: hit.content[0].text,
    search_result_index: 0, start_block_index: 0, end_block_index: 0,
  };
  return [
    ['message_start', { type: 'message_start', message: message() }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: [] } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Proxi masks card numbers.' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
}

function message() {
  return { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } };
}

function statusFrom(body) {
  const result = body.messages.at(-1).content.find((block) => block.type === 'tool_result');
  return JSON.parse(result.content[0].text).status;
}

function signJwt(privateKey, claims) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now, nbf: now - 5, exp: now + 300, ...claims })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function freePort() {
  const probe = http.createServer();
  await listen(probe);
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
