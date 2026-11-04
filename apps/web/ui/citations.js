// Turns the citation links in a reply into source pills and a collapsible list.

export const DOCS_URL = 'https://proxi.mintlify.site';

// Citations arrive as Markdown: [[1]](url) after a sentence and a "Sources" list at the end.
// Turn them into source name pills and a collapsible list. Runs on sanitized HTML.
// Shows a source's site icon once it loads. Load events don't bubble, so this listens in the capture phase.
if (typeof document !== 'undefined') {
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains('site-img')) e.target.parentElement?.classList.add('has-img');
  }, true);
}

export function renderCitations(html) {
  if (!html.includes('<strong>Sources</strong>')) return html;
  const root = document.createElement('template');
  root.innerHTML = html;
  // Proxi's list is the last one. A model sometimes writes its own as well: drop those copies.
  const lists = [...root.content.querySelectorAll('p')]
    .filter((p) => p.textContent.trim() === 'Sources' && p.querySelector('strong') && p.nextElementSibling?.tagName === 'OL');
  if (!lists.length) return html;
  const heading = lists.at(-1);
  const list = heading.nextElementSibling;
  for (const p of lists.slice(0, -1)) { p.nextElementSibling.remove(); p.remove(); }
  const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const label = (url) => url.startsWith(DOCS_URL) ? 'Help center' : host(url);
  // Site icon, fetched through Proxi's own server so the icon service never sees the visitor's IP address.
  // This returns HTML text, so the icon is in the markup, hidden until the page-wide listener
  // below sees it load. The colored letter stays if it doesn't.
  const siteIcon = (name, url, cls) => {
    const el = document.createElement('span');
    el.className = cls + ' t' + ([...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5);
    const letter = document.createElement('span');
    letter.className = 'site-letter';
    letter.textContent = name[0].toUpperCase();
    el.append(letter);
    const h = host(url);
    if (h) {
      const img = document.createElement('img');
      img.className = 'site-img'; img.alt = ''; img.setAttribute('referrerpolicy', 'no-referrer');
      img.src = '/api/icon?host=' + encodeURIComponent(h);
      el.append(img);
    }
    return el;
  };
  const sources = [...list.querySelectorAll('a')].map((a) => ({ url: a.getAttribute('href'), title: a.textContent }));
  const link = (url, cls) => {
    const a = document.createElement('a');
    a.href = url; a.className = cls; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };
  // Consecutive [n] links become one pill: "Help center +1".
  const cites = [...root.content.querySelectorAll('a')].filter((a) => /^\[\d+\]$/.test(a.textContent));
  const groups = [];
  for (const a of cites) {
    const last = groups.at(-1);
    if (last && last.at(-1).nextSibling === a) last.push(a); else groups.push([a]);
  }
  for (const group of groups) {
    const url = group[0].getAttribute('href');
    const pill = link(url, 'cite');
    pill.textContent = label(url) + (group.length > 1 ? ' +' + (group.length - 1) : '');
    pill.title = group.map((a) => sources.find((s) => s.url === a.getAttribute('href'))?.title || label(a.getAttribute('href'))).join('\n');
    group[0].replaceWith(pill);
    group.slice(1).forEach((a) => a.remove());
  }
  const details = document.createElement('details');
  details.className = 'sources';
  const summary = document.createElement('summary');
  const stack = document.createElement('span');
  stack.className = 'src-stack';
  stack.setAttribute('aria-hidden', 'true');
  // One tile per site, up to three.
  const seen = new Set();
  for (const src of sources) {
    const name = label(src.url) || '?';
    if (seen.has(name) || seen.size === 3) continue;
    seen.add(name);
    stack.append(siteIcon(name, src.url, 'src-tile'));
  }
  summary.append(stack, sources.length === 1 ? '1 source' : sources.length + ' sources');
  const ul = document.createElement('ul');
  for (const src of sources) {
    const a = link(src.url, '');
    const title = document.createElement('span');
    title.className = 'src-title'; title.textContent = src.title;
    const site = document.createElement('span');
    site.className = 'src-site';
    const name = label(src.url) || '?';
    site.append(siteIcon(name, src.url, 'src-ico'), host(src.url));
    a.append(site, title);
    const li = document.createElement('li');
    li.append(a);
    ul.append(li);
  }
  details.append(summary, ul);
  heading.replaceWith(details);
  list.remove();
  return root.innerHTML;
}
