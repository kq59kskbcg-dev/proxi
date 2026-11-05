import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../api/icon.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

let ipCounter = 0;
const get = (host) => GET(new Request('http://localhost/api/icon?host=' + encodeURIComponent(host), {
  headers: { 'x-forwarded-for': '10.0.0.' + (++ipCounter % 250) },
}));

test('fetches the icon from the icon service on the server, without the visitor details', async () => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/x-icon' } });
  };
  const res = await get('Example.com');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/x-icon');
  assert.match(res.headers.get('cache-control'), /s-maxage=/);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assert.equal(seen.url, 'https://icons.duckduckgo.com/ip3/example.com.ico');
  assert.equal(seen.init.headers, undefined);
  assert.equal(seen.init.redirect, 'error');
});

test('rejects anything that is not a plain domain name, without fetching', async () => {
  globalThis.fetch = async () => { throw new Error('should not fetch'); };
  for (const host of ['', 'localhost', '127.0.0.1', 'a/b.com', 'example.com/../x', 'exa mple.com', '-bad.com', 'x'.repeat(64) + '.com', 'example.com:8080', '[::1]']) {
    assert.equal((await get(host)).status, 400, host);
  }
});

test('returns 404 when the service has no icon, or sends something that is not an image', async () => {
  globalThis.fetch = async () => new Response('nope', { status: 404 });
  assert.equal((await get('missing.example')).status, 404);
  globalThis.fetch = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  assert.equal((await get('html.example')).status, 404);
  globalThis.fetch = async () => new Response(new Uint8Array(200 * 1024), { headers: { 'content-type': 'image/png' } });
  assert.equal((await get('huge.example')).status, 404);
  globalThis.fetch = async () => { throw new Error('timeout'); };
  assert.equal((await get('down.example')).status, 404);
});

test('limits how many icons one address can ask for', async () => {
  globalThis.fetch = async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
  const req = () => GET(new Request('http://localhost/api/icon?host=example.com', { headers: { 'x-forwarded-for': '192.0.2.9' } }));
  for (let i = 0; i < 300; i++) assert.equal((await req()).status, 200);
  assert.equal((await req()).status, 429);
});
