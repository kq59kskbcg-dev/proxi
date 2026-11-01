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

test('every script comes from Proxi or Clerk, and no public code host is allowed', () => {
  const srcs = scripts.map((s) => s.attrs.match(/\bsrc="([^"]+)"/)?.[1]).filter(Boolean);
  assert.ok(srcs.length > 0);
  for (const src of srcs) {
    assert.ok(src.startsWith('/') || src.startsWith('https://fond-sloth-104.clerk.accounts.dev/'), `${src} is not served by Proxi or Clerk`);
  }
  assert.ok(!csp.includes('jsdelivr'), 'jsDelivr is allowed in the CSP but nothing loads from it');
});

test('fonts and site icons come from Proxi, so the CSP allows no font or icon host', () => {
  const directive = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '));
  assert.equal(directive('font-src'), "font-src 'self'");
  assert.ok(!/duckduckgo|googleapis|gstatic/.test(csp));
  assert.ok(!/fonts\.googleapis|icons\.duckduckgo/.test(html), 'the page still loads fonts or icons from another host');
});
