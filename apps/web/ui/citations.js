// Turns the citation links in a reply into source pills and a collapsible list.

export const DOCS_URL = 'https://proxi.mintlify.site';

// Citations arrive as Markdown: [[1]](url) after a sentence and a "Sources" list at the end.
// Turn them into number pills and a collapsible list. Runs on sanitized HTML, on every render,
// so the pills show while a reply streams, before the Sources list arrives.
export function renderCitations(html) {
  const hasCites = /<a [^>]*>\[\d+\]<\/a>/.test(html);
  const hasList = html.includes('<strong>Sources</strong>');
  if (!hasCites && !hasList) return html;
  const root = document.createElement('template');
  root.innerHTML = html;
  // Proxi's list is the last one. A model sometimes writes its own as well: drop those copies.
  const lists = [...root.content.querySelectorAll('p')]
    .filter((p) => p.textContent.trim() === 'Sources' && p.querySelector('strong') && p.nextElementSibling?.tagName === 'OL');
  const heading = lists.at(-1);
  const list = heading?.nextElementSibling;
  for (const p of lists.slice(0, -1)) { p.nextElementSibling.remove(); p.remove(); }
  const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const label = (url) => url.startsWith(DOCS_URL) ? 'Help center' : host(url);
  // Site icon from a public favicon service; the colored letter stays if it doesn't load.
  const siteIcon = (name, url, cls) => {
    const el = document.createElement('span');
    el.className = cls + ' t' + ([...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5);
    el.textContent = name[0].toUpperCase();
    const h = host(url);
    if (h) {
      const img = new Image();
      img.alt = ''; img.referrerPolicy = 'no-referrer';
      img.onload = () => { el.textContent = ''; el.classList.add('has-img'); el.append(img); };
      img.src = 'https://icons.duckduckgo.com/ip3/' + encodeURIComponent(h) + '.ico';
    }
    return el;
  };
  const sources = list ? [...list.querySelectorAll('a')].map((a) => ({ url: a.getAttribute('href'), title: a.textContent })) : [];
  const link = (url, cls) => {
    const a = document.createElement('a');
    a.href = url; a.className = cls; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };
  // Each [n] link becomes a number pill, with the page's title (or site) as its tooltip.
  const cites = [...root.content.querySelectorAll('a')].filter((a) => /^\[\d+\]$/.test(a.textContent) && !a.closest('ol'));
  for (const a of cites) {
    const url = a.getAttribute('href');
    const n = a.textContent.slice(1, -1);
    const pill = link(url, 'cite');
    pill.textContent = n;
    const title = sources.find((s) => s.url === url)?.title || label(url);
    pill.title = title;
    pill.setAttribute('aria-label', 'Source ' + n + (title ? ': ' + title : ''));
    a.replaceWith(pill);
  }
  if (!list) return root.innerHTML;
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
