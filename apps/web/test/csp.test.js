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

test("scripts can't be built from strings: no 'unsafe-eval', and Vue is the runtime-only build", () => {
  assert.ok(!scriptSrc.includes("'unsafe-eval'"));
  const vue = scripts.map((s) => s.attrs.match(/src="([^"]*\/vue@[^"]+)"/)?.[1]).filter(Boolean);
  assert.deepEqual(vue, ['https://cdn.jsdelivr.net/npm/vue@3.4.38/dist/vue.runtime.global.prod.js']);
});

test('ui/template.js is compiled from the current #tpl (run `npm run build:template` in apps/web)', async () => {
  const { buildTemplate } = await import('../scripts/build-template.js');
  const compiled = readFileSync(new URL('../ui/template.js', import.meta.url), 'utf8');
  assert.ok(compiled === buildTemplate(html), 'ui/template.js is out of date: run `npm run build:template` in apps/web');
});

test('the template compiler matches the Vue version the page loads', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const loaded = html.match(/\/npm\/vue@([\d.]+)\//)[1];
  assert.equal(pkg.devDependencies['@vue/compiler-dom'], loaded);
});
