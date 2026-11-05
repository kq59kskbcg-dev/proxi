import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../lib/server.js';
import { escalationEmail, emailConfigured, EMAIL } from '../lib/resend.js';

const sent = [];
let status = 200;
const realFetch = globalThis.fetch;

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

let client;

before(async () => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.SUPPORT_EMAIL_TO = 'owner@example.com';
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(status === 200 ? { id: 'email_1' } : { message: 'rejected for owner@example.com' }), { status });
  };
  client = await connect();
});

after(async () => {
  globalThis.fetch = realFetch;
  await client.close();
  delete process.env.RESEND_API_KEY;
  delete process.env.SUPPORT_EMAIL_TO;
});

beforeEach(() => { sent.length = 0; status = 200; });

const call = (args) => client.callTool({ name: 'send_escalation_email', arguments: args });

test('send_escalation_email is offered only when Resend and the recipient are set', async () => {
  assert.ok((await client.listTools()).tools.some((t) => t.name === 'send_escalation_email'));
  delete process.env.SUPPORT_EMAIL_TO;
  assert.equal(emailConfigured(), false);
  const bare = await connect();
  assert.ok(!(await bare.listTools()).tools.some((t) => t.name === 'send_escalation_email'));
  await bare.close();
  process.env.SUPPORT_EMAIL_TO = 'owner@example.com';
});

test('it sends a plain-text email to the owner with the reply-to address', async () => {
  const result = await call({ summary: 'Their shared link stopped opening.', reply_to: 'sam@example.com' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { sent: true, id: 'email_1' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].headers.authorization, 'Bearer re_test');
  const body = sent[0].body;
  assert.deepEqual(body.to, ['owner@example.com']);
  assert.equal(body.from, 'Proxi <onboarding@resend.dev>');
  assert.equal(body.reply_to, 'sam@example.com');
  assert.equal(body.subject, 'Proxi: Their shared link stopped opening.');
  assert.match(body.text, /Their shared link stopped opening\./);
  assert.equal(body.html, undefined);
});

test('an invalid address or empty summary is refused before anything is sent', async () => {
  for (const args of [
    { summary: 'Help', reply_to: 'not-an-email' },
    { summary: 'Help', reply_to: 'a@b.com, c@d.com' },
    { summary: 'Help', reply_to: 'Sam <sam@example.com>' },
    { summary: '   ', reply_to: 'sam@example.com' },
    { summary: 'x'.repeat(1001), reply_to: 'sam@example.com' },
  ]) {
    const result = await call(args);
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  assert.equal(sent.length, 0);
});

test('a failed send is an error that does not repeat Resend\'s message', async () => {
  status = 422;
  const result = await call({ summary: 'Help', reply_to: 'sam@example.com' });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "The email couldn't be sent.");
});

test('long first lines are shortened in the subject', () => {
  process.env.SUPPORT_EMAIL_TO = 'owner@example.com';
  const email = escalationEmail('a'.repeat(80) + '\nmore', 'sam@example.com');
  assert.equal(email.subject, 'Proxi: ' + 'a'.repeat(60) + '...');
  assert.ok(EMAIL.test('first.last+tag@sub.example.co'));
  assert.ok(!EMAIL.test('sam@example'));
});
