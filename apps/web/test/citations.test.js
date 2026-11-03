import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

// renderCitations builds its HTML with the DOM, so give it one.
const { document, HTMLImageElement, HTMLTemplateElement } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.document = document;
// In a browser a <template>'s innerHTML is its content; linkedom keeps the parsed source.
let proto = HTMLTemplateElement.prototype, own;
while (!(own = Object.getOwnPropertyDescriptor(proto, 'innerHTML'))) proto = Object.getPrototypeOf(proto);
Object.defineProperty(HTMLTemplateElement.prototype, 'innerHTML', {
  configurable: true,
  set(html) { own.set.call(this, html); },
  get() { const div = document.createElement('div'); div.append(this.content.cloneNode(true)); return div.innerHTML; }
});
globalThis.HTMLImageElement = HTMLImageElement;
const { renderCitations, dropFailedIcon } = await import('../ui/citations.js');

const reply = '<p>Kept for 30 days <a href="https://proxi.mintlify.site/privacy">[1]</a> and redacted <a href="https://github.com/x/y">[2]</a>.</p>' +
  '<p><strong>Sources</strong></p><ol><li><a href="https://proxi.mintlify.site/privacy">Privacy</a></li><li><a href="https://github.com/x/y">Code</a></li></ol>';

test('each source icon is part of the returned HTML, over its colored letter', () => {
  const root = document.createElement('div');
  root.innerHTML = renderCitations(reply);
  const icons = [...root.querySelectorAll('.src-tile, .src-ico')];
  assert.equal(icons.length, 4, 'two tiles in the summary and two in the list');
  for (const icon of icons) {
    assert.match(icon.textContent, /^[A-Z]$/, 'the letter stays as the fallback');
    const img = icon.querySelector('img');
    assert.ok(img, 'the icon image is in the HTML');
    assert.match(img.getAttribute('src'), /^https:\/\/icons\.duckduckgo\.com\/ip3\/(proxi\.mintlify\.site|github\.com)\.ico$/);
    assert.equal(img.getAttribute('alt'), '');
    assert.equal(img.getAttribute('referrerpolicy'), 'no-referrer');
  }
});

test('an icon that fails to load is removed, so its letter shows', () => {
  const root = document.createElement('div');
  root.innerHTML = renderCitations(reply);
  const img = root.querySelector('.src-ico img');
  const tile = img.parentElement;
  dropFailedIcon({ target: img });
  assert.equal(tile.querySelector('img'), null);
  assert.match(tile.textContent, /^[A-Z]$/);
  const other = document.createElement('img');
  root.append(other);
  dropFailedIcon({ target: other });
  assert.equal(other.parentElement, root, 'other images are left alone');
});

test('the CSP allows the icon host', async () => {
  const { readFileSync } = await import('node:fs');
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
  const imgSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('img-src '));
  assert.ok(imgSrc.split(/\s+/).includes('https://icons.duckduckgo.com'));
});
