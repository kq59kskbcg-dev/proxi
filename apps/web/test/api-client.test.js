import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, readProblem } from '../ui/api.js';
import { CHAT_TOO_LARGE, OWN_CARDS } from '../ui/limits.js';

// A fetch stand-in that records each call and answers with the next queued Response.
function fakeFetch(...responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetch };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = (f) => createApi({ getToken: async () => 'tok', fetch: f.fetch });

test('get sends the Clerk token and returns the parsed reply', async () => {
  const f = fakeFetch(json({ conversations: [] }));
  assert.deepEqual(await client(f).get('/api/conversations'), { conversations: [] });
  assert.deepEqual(f.calls, [{ url: '/api/conversations', init: { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' } } }]);
});

test('query values are URL-encoded', async () => {
  const f = fakeFetch(json({}));
  await client(f).get('/api/conversations', { query: { id: 'a b/c' } });
  assert.equal(f.calls[0].url, '/api/conversations?id=a%20b%2Fc');
});

test('post, put and delete send their method and a JSON body', async () => {
  const f = fakeFetch(json({ shareId: 's1' }), json({ ok: true }), new Response(null, { status: 204 }));
  const api = client(f);
  assert.deepEqual(await api.post('/api/share', { id: 'c1' }), { shareId: 's1' });
  assert.deepEqual(await api.put('/api/settings', { chatRetentionDays: 7 }), { ok: true });
  assert.equal(await api.delete('/api/memories', { query: { id: 'm1' } }), null);
  assert.deepEqual(f.calls.map((c) => [c.init.method, c.url, c.init.body]), [
    ['POST', '/api/share', '{"id":"c1"}'],
    ['PUT', '/api/settings', '{"chatRetentionDays":7}'],
    ['DELETE', '/api/memories?id=m1', undefined]
  ]);
});

test('a string body is sent as it is', async () => {
  const f = fakeFetch(json({}));
  await client(f).post('/api/chat', '{"already":"json"}');
  assert.equal(f.calls[0].init.body, '{"already":"json"}');
});

test('a reply that is not ok throws an ApiError with its status and body', async () => {
  const f = fakeFetch(json({ code: '42P01' }, 500), new Response('not json', { status: 503 }));
  const api = client(f);
  await assert.rejects(api.get('/api/conversations'), (e) => e instanceof ApiError && e.status === 500 && e.data.code === '42P01');
  await assert.rejects(api.get('/api/conversations'), (e) => e instanceof ApiError && e.status === 503 && JSON.stringify(e.data) === '{}');
});

test('network errors are thrown as they are, not as an ApiError', async () => {
  const f = fakeFetch(new TypeError('Failed to fetch'));
  await assert.rejects(client(f).get('/api/memories'), (e) => e instanceof TypeError && !(e instanceof ApiError));
});

test('auth: false sends no headers, for the public shared-chat endpoint', async () => {
  let asked = false;
  const f = fakeFetch(json({ title: 'x', messages: [] }));
  const api = createApi({ getToken: async () => { asked = true; return 'tok'; }, fetch: f.fetch });
  await api.get('/api/shared', { query: { id: 'abc' }, auth: false });
  assert.deepEqual(f.calls[0].init, {});
  assert.equal(asked, false);
});

test('raw: true returns the Response without checking it, and passes the abort signal', async () => {
  const res = json({ card: { title: 't' } }, 500);
  const f = fakeFetch(res);
  const signal = new AbortController().signal;
  assert.equal(await client(f).post('/api/chat', '{}', { raw: true, signal }), res);
  assert.equal(f.calls[0].init.signal, signal);
});

test('readProblem uses the server card or message, else a card with the status', async () => {
  assert.deepEqual(await readProblem(json({ card: { title: 'Busy', body: 'Wait' } }, 529)), { card: { title: 'Busy', body: 'Wait' } });
  assert.deepEqual(await readProblem(json({ error: 'Declined' }, 400)), { text: 'Declined' });
  assert.deepEqual(await readProblem(new Response('oops', { status: 502 })), { card: { ...OWN_CARDS.error, ref: '502' } });
  assert.deepEqual(await readProblem(new Response('', { status: 413 })), { text: CHAT_TOO_LARGE });
});
