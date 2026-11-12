import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const mcpDir = fileURLToPath(new URL('../../mcp/', import.meta.url));
const ready = existsSync(new URL('../../mcp/node_modules/', import.meta.url));
// Locally the tests skip without the MCP server's packages. In CI that would hide them, so fail.
if (!ready && process.env.CI) {
  throw new Error('apps/mcp/node_modules is missing: run npm ci in apps/mcp before these tests');
}

const requests = [];
let script = [];
let fakeClaude;
let fakeMintlify;
let mcpServer;
let token;
let signing;

before(async () => {
  if (!ready) return;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.CLERK_JWT_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
  signing = keys.privateKey;
  token = signJwt(signing, { sub: 'user_e2e', azp: 'https://localhost' });

  fakeClaude = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      // A call the test didn't script fails at once instead of leaving the request hanging.
      if (!script.length) {
        res.writeHead(500, { 'content-type': 'application/json', 'x-should-retry': 'false' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'unscripted call' } }));
        return;
      }
      // A non-streamed call (a classifier) gets a plain JSON message with the script's text.
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...message(), content: [{ type: 'text', text: script.shift()(body) }], stop_reason: 'end_turn' }));
        return;
      }
      const turn = script.shift()(body);
      // A turn can be an error from Claude instead of events. It isn't retried, so one call is one turn.
      if (turn.status) {
        res.writeHead(turn.status, { 'content-type': 'application/json', 'x-should-retry': 'false' });
        res.end(JSON.stringify({ type: 'error', error: { type: turn.type, message: 'rejected' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [event, data] of turn) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    });
  });
  await listen(fakeClaude);
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fakeClaude.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';

  fakeMintlify = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`# Privacy\nSource: https://proxi.mintlify.site/privacy\n\n${PRIVACY_TEXT}\n`);
  });
  await listen(fakeMintlify);

  // The MCP server and the agent share a token, as in production.
  process.env.MCP_TOKEN = 'test-mcp-token';
  const port = await freePort();
  mcpServer = spawn(process.execPath, ['server.js'], {
    cwd: mcpDir,
    env: {
      ...process.env,
      PORT: String(port),
      MINTLIFY_DOCS_URL: `http://127.0.0.1:${fakeMintlify.address().port}`,
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

async function chat(question, extra = {}, bearer = token) {
  requests.length = 0;
  const { POST } = await import('../api/chat.js');
  const response = await POST(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, host: 'localhost', 'content-type': 'application/json' },
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
  assert.deepEqual(activity, { type: 'activity', tool: 'get_status', label: "Checking Proxi's status", done: "Checked Proxi's status", detail: "Checked Proxi's status" });
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

test('a citation marker is shown only when the cited source changes', { skip }, async () => {
  const a = 'https://proxi.mintlify.site/privacy';
  const b = 'https://proxi.mintlify.site/security';
  script = [
    () => toolUseTurn('search_docs', { query: 'how is my data protected' }),
    () => citedBlocksTurn([
      { text: '- Card numbers are masked.', source: a },
      { text: '\n- So are IBANs.', source: a },
      { text: '\n- Traffic uses HTTPS.', source: b },
      { text: '\n- Chats can be deleted.', source: a },
      { text: '\n\nIn short:' },
      { text: '\n- Incognito chats are not saved.', source: a },
    ]),
  ];
  const events = await chat('How is my data protected?');

  const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
  const reply = text.slice(0, text.indexOf('\n\n**Sources**'));
  assert.equal(reply, [
    `- Card numbers are masked. [[1]](${a})`,
    '- So are IBANs.',
    `- Traffic uses HTTPS. [[2]](${b})`,
    `- Chats can be deleted. [[1]](${a})`,
    '',
    'In short:',
    `- Incognito chats are not saved. [[1]](${a})`,
  ].join('\n'));
});

test('a request Claude rejects is "something went wrong on our side", not a message about length', { skip }, async () => {
  // What the web search bug looked like: a 400 for a request Proxi built, with a message that was fine.
  script = [() => ({ status: 400, type: 'invalid_request_error' })];
  const events = await chat('What is the weather in Lisbon?');

  const error = events.find((e) => e.type === 'error');
  assert.deepEqual(error.card, { title: 'Something went wrong on our side', body: 'Your message is fine. Try again.', ref: '400' });
  assert.equal(error.error, 'Something went wrong on our side. Your message is fine. Try again.');
  assert.ok(!events.some((e) => e.type === 'done'));
});

test('a busy Claude is "busy right now", with the status as the reference', { skip }, async () => {
  script = [() => ({ status: 429, type: 'rate_limit_error' })];
  assert.deepEqual((await chat('Hello')).find((e) => e.type === 'error').card,
    { title: 'Proxi is busy right now', body: 'Too many requests at once. Try again in a minute.', ref: '429' });

  script = [() => ({ status: 529, type: 'overloaded_error' })];
  assert.equal((await chat('Hello')).find((e) => e.type === 'error').card.ref, '529');
});

test('no sign-in is a card about the session, and a missing setup is on our side', { skip }, async () => {
  const response = await post({ model: 'Haiku 5.5', messages: [{ role: 'user', content: 'Hello' }] }, null);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.deepEqual(body.card, { title: 'Your session expired', body: 'Try again to sign back in. If it keeps happening, reload the page.', ref: '401 · no-token' });
  assert.equal(body.error, `${body.card.title}. ${body.card.body}`);
});

test('sending too fast is "too many messages"', { skip }, async () => {
  const fast = signJwt(signing, { sub: 'user_fast', azp: 'https://localhost' });
  let last;
  for (let i = 0; i < 21; i++) last = await post('{}', fast);
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.deepEqual((await last.json()).card, { title: 'Too many messages', body: "You've sent a lot of messages in a short time. Wait a few minutes, then try again.", ref: '429 · limit' });
});

test('a message can be 20,000 characters, and one character more is refused', { skip }, async () => {
  script = [() => textTurn('Got it.')];
  const ok = await post({ model: 'Haiku 5.5', messages: [{ role: 'user', content: 'a'.repeat(20000) }] });
  assert.equal(ok.status, 200);
  await ok.text();

  const long = await post({ model: 'Haiku 5.5', messages: [{ role: 'user', content: 'a'.repeat(20001) }] });
  assert.equal(long.status, 400);
  assert.equal((await long.json()).card.ref, '400 · invalid');
});

test('a chat holds 100 of the user\'s messages; the 101st is refused with the limit as plain text', { skip }, async () => {
  const chatOf = (users) => Array.from({ length: users * 2 - 1 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i}` }));

  // Messages older than the latest 40 are summarized first (a non-streamed call), then the reply.
  script = [() => 'The user is counting messages.', () => textTurn('Still here.')];
  const full = await post({ model: 'Haiku 5.5', messages: chatOf(100) });
  assert.equal(full.status, 200);
  await full.text();
  const reply = requests.find((body) => body.stream);
  assert.ok(reply.messages.length <= 40, 'the model is only sent the latest messages');
  assert.equal(reply.messages.at(-1).content, 'message 198');

  const over = await post({ model: 'Haiku 5.5', messages: chatOf(101) });
  assert.equal(over.status, 400);
  const body = await over.json();
  assert.equal(body.error, 'This chat has reached its limit of 100 of your messages. Start a new chat to keep going.');
  assert.equal(body.card, undefined, 'a plain message, not a card with Try again');
});

test('a long earlier reply does not break the chat, and the model gets it cut', { skip }, async () => {
  // A reply can run past 20,000 characters (8,000 tokens, plus the links Proxi adds).
  script = [() => textTurn('You are welcome.')];
  const reply = 'word '.repeat(10000);
  const response = await post({ model: 'Haiku 5.5', messages: [
    { role: 'user', content: 'Write me a very long essay.' },
    { role: 'assistant', content: reply },
    { role: 'user', content: 'Thanks.' },
  ] });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(requests[0].messages[1].content.length, 40000);
  assert.equal(requests[0].messages[0].content, 'Write me a very long essay.');
});

test('an attachment that can\'t be used keeps its own plain message', { skip }, async () => {
  const data = Buffer.from('%PDF-1.4 this is not really a pdf').toString('base64');
  const response = await post({ model: 'Haiku 5.5', messages: [{ role: 'user', content: 'Read this', attachments: [{ name: 'report.pdf', type: 'application/pdf', data }] }] });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.match(body.error, /report\.pdf could not be read as a PDF/);
  assert.equal(body.card, undefined);
});

// Its own user, so these requests don't count towards user_e2e's rate limit.
const searchToken = () => signJwt(signing, { sub: 'user_search', azp: 'https://localhost' });

// The chat API reads saved chats from a local Postgres for these tests, then goes back to none.
async function withDatabase(fn) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { setDriver } = await import('../lib/db.js');
  const pg = new PGlite();
  setDriver({
    query: async (text, params) => (await pg.query(text, params)).rows,
    transaction: (steps) => pg.transaction(async (tx) => { for (const [text, params] of steps) await tx.query(text, params); }),
  });
  try { await fn(); } finally { setDriver(null); await pg.close(); }
}

test('search_chats finds only the signed-in user\'s saved chats and cites them as links to the chat', { skip }, async () => {
  await withDatabase(async () => {
    const { saveConversation } = await import('../lib/db.js');
    await saveConversation('user_search', 'lisbon-1', 'Lisbon trip planning', [
      { role: 'user', content: 'Which hotel should we book in Lisbon?' },
      { role: 'assistant', content: 'Casa do Largo in Alfama has a rooftop.' },
    ]);
    await saveConversation('user_search', 'pasta-1', 'Pasta dinner', [{ role: 'user', content: 'Carbonara for four' }]);
    await saveConversation('user_other', 'theirs-1', 'Lisbon hotel secrets', [{ role: 'user', content: 'My Lisbon hotel is a secret' }]);

    script = [() => toolUseTurn('search_chats', { query: 'Lisbon hotel' }), (body) => citedTextTurn(body)];
    const events = await chat('What was the hotel we picked for Lisbon?', {}, searchToken());

    assert.ok(requests[0].tools.some((tool) => tool.name === 'search_chats'));
    const result = requests[1].messages.at(-1).content[0];
    assert.equal(result.type, 'tool_result');
    assert.equal(result.content.length, 1, 'only the user\'s own matching chat');
    const hit = result.content[0];
    assert.equal(hit.type, 'search_result');
    assert.equal(hit.source, 'http://localhost/?chat=lisbon-1');
    assert.equal(hit.title, 'Lisbon trip planning');
    const passages = hit.content.map((c) => c.text).join('\n');
    assert.match(passages, /User: Which hotel should we book in Lisbon\?/);
    assert.doesNotMatch(passages, /secret/);

    const activity = events.find((e) => e.type === 'activity');
    assert.equal(activity.label, 'Searching your chats');
    const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    assert.match(text, /\*\*Sources\*\*\n1\. \[Lisbon trip planning\]\(http:\/\/localhost\/\?chat=lisbon-1\)$/);
  });
});

test('search_chats is not offered in incognito chats', { skip }, async () => {
  await withDatabase(async () => {
    script = [() => textTurn('Sure.')];
    await chat('What did we talk about?', { temporary: true }, searchToken());
    assert.ok(!(requests[0].tools ?? []).some((tool) => tool.name === 'search_chats'));
  });
});

test('tools turned off in Settings are not offered, and saved memories are still used', { skip }, async () => {
  await withDatabase(async () => {
    const { saveSettings, addMemory } = await import('../lib/db.js');
    await saveSettings('user_search', { disabledTools: ['web_search', 'search_chats', 'save_memory'] });
    await addMemory('user_search', 'mem-1', 'Prefers metric units');
    script = [() => textTurn('Sure.')];
    await chat('What did we talk about?', {}, searchToken());
    const names = (requests[0].tools ?? []).map((tool) => tool.name);
    for (const off of ['web_search', 'search_chats', 'save_memory']) assert.ok(!names.includes(off), off + ' is off');
    for (const on of ['search_docs', 'get_status']) assert.ok(names.includes(on), on + ' stays on');
    assert.match(JSON.stringify(requests[0].system), /Prefers metric units/);
  });
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

test('Auto asks the routing classifier, then replies with the model it picked', { skip }, async () => {
  script = [() => 'complex', () => textTurn('Here is a design.')];
  const events = await chat('Design a sync system for offline notes', { model: 'Auto', temporary: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, 'claude-haiku-5-5');
  assert.match(requests[0].messages[0].content, /simple, standard or complex[\s\S]*Design a sync system for offline notes$/);
  assert.equal(requests[1].model, 'claude-opus-5-5');
  assert.equal(events.at(-1).type, 'done');
});

test('an unknown model is refused', { skip }, async () => {
  const { POST } = await import('../api/chat.js');
  const response = await POST(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, host: 'localhost', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'GPT', messages: [{ role: 'user', content: 'Hi' }] }),
  }));
  assert.equal(response.status, 400);
});

test('only the message just sent is counted as redacted, and replies are not redacted', { skip }, async () => {
  script = [(body) => textTurn(JSON.stringify(body.messages.map((m) => m.content)))];
  const events = await chat('', { messages: [
    { role: 'user', content: 'Mail me at jane@example.com' },
    { role: 'assistant', content: 'Proxi was released on 2026-10-27.' },
    { role: 'user', content: 'Can you answer what Proxi is?' },
  ] });
  assert.deepEqual(events[0].redactions, {});
  const sent = JSON.parse(events.filter((e) => e.type === 'text').map((e) => e.text).join(''));
  assert.equal(sent[0], 'Mail me at [EMAIL]');
  assert.equal(sent[1], 'Proxi was released on 2026-10-27.');
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

// Posts to the chat route and returns the Response as is. A null token sends no sign-in.
async function post(body, bearer = token) {
  requests.length = 0;
  const { POST } = await import('../api/chat.js');
  return POST(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), host: 'localhost', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
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

// One text block per item; an item with a source cites it.
function citedBlocksTurn(items) {
  const blocks = items.flatMap((item, index) => {
    const citation = item.source && {
      type: 'search_result_location', source: item.source, title: item.source, cited_text: item.text,
      search_result_index: 0, start_block_index: 0, end_block_index: 0,
    };
    return [
      ['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: [] } }],
      ...(citation ? [['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'citations_delta', citation } }]] : []),
      ['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: item.text } }],
      ['content_block_stop', { type: 'content_block_stop', index }],
    ];
  });
  return [
    ['message_start', { type: 'message_start', message: message() }],
    ...blocks,
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
