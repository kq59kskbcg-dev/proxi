// Compiles the page's Vue template (#tpl in index.html) into ui/template.js, so the page can use
// Vue's runtime-only build and its security policy doesn't need 'unsafe-eval'. Run it after
// changing #tpl: `npm run build:template` in apps/web. A test fails if ui/template.js is out of date.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from '@vue/compiler-dom';

const INDEX = new URL('../index.html', import.meta.url);
const OUT = new URL('../ui/template.js', import.meta.url);

// The template's source, exactly as the browser would read it from the <script> element.
export function templateSource(html) {
  const m = html.match(/<script type="text\/x-template" id="tpl">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No <script type="text/x-template" id="tpl"> in index.html');
  return m[1];
}

// The module ui/template.js should hold. Vue is the page's global (vue.runtime.global.prod.js),
// so the compiler's import from "vue" becomes a read of window.Vue.
export function buildTemplate(html) {
  const { code } = compile(templateSource(html), { mode: 'module', hoistStatic: true, cacheHandlers: true });
  const withGlobal = code.replace(/^import \{ ([^}]+) \} from "vue"$/m, (_, names) =>
    'const { ' + names.split(', ').map((n) => n.replace(' as ', ': ')).join(', ') + ' } = Vue;');
  if (/\bfrom "vue"/.test(withGlobal)) throw new Error('Unexpected import from "vue" in the compiled template');
  return '// Generated from #tpl in index.html by `npm run build:template`. Do not edit by hand.\n' +
    '/* eslint-disable */\n' + withGlobal.trimEnd() + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, buildTemplate(readFileSync(INDEX, 'utf8')));
  console.log('Wrote ui/template.js');
}
