import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')).split(/\s+/).slice(1);
const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1] || '', body: m[2] }));

test('inline scripts run only because their hash is in the CSP, not because of unsafe-inline', () => {
  assert.ok(!scriptSrc.includes("'unsafe-inline'"));
  const inline = scripts.filter((s) => !/\bsrc=/.test(s.attrs) && !/\btype=/.test(s.attrs));
  assert.ok(inline.length > 0);
  for (const s of inline) {
    const hash = `'sha256-${createHash('sha256').update(s.body).digest('base64')}'`;
    assert.ok(scriptSrc.includes(hash), `Inline script changed: put ${hash} in script-src in vercel.json`);
  }
});

test('every jsDelivr script is pinned in the CSP and checked with an integrity hash', () => {
  const cdn = scripts.filter((s) => /src="https:\/\/cdn\.jsdelivr\.net\//.test(s.attrs));
  assert.ok(cdn.length > 0);
  assert.ok(!scriptSrc.includes('https://cdn.jsdelivr.net'), 'jsDelivr is allowed as a whole');
  for (const s of cdn) {
    const src = s.attrs.match(/src="([^"]+)"/)[1];
    assert.ok(scriptSrc.includes(src), `${src} is not in script-src`);
    assert.match(s.attrs, /integrity="sha384-[A-Za-z0-9+/=]+"/, `${src} has no integrity hash`);
    assert.match(s.attrs, /crossorigin="anonymous"/, `${src} needs crossorigin for its integrity check`);
  }
});
