// Turns the citation links in a reply into source pills and a collapsible list.

export const DOCS_URL = 'https://proxi.mintlify.site';

// A source that is one of the user's own chats (from search_chats) links to /?chat=<id> on this site.
// Returns the chat's ID, or null for any other link.
export function chatLinkId(url, origin) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const id = u.searchParams.get('chat');
  return u.origin === origin && u.pathname === '/' && id && /^[\w-]{1,64}$/.test(id) ? id : null;
}

const CHAT_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path></svg>';

// Shows a source's site icon once it loads. Load events don't bubble, so this listens in the capture phase.
if (typeof document !== 'undefined') {
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains('site-img')) e.target.parentElement?.classList.add('has-img');
  }, true);
}

// Citations arrive as Markdown: [[1]](url) after a sentence and a "Sources" list at the end.
// Turn them into number pills and a collapsible list. Runs on sanitized HTML, on every render,
// so the pills show while a reply streams, before the Sources list arrives.
// Options: chatDate(id) gives the date a cited chat was last used (or ''); linkChats: false shows
// cited chats without links (on a shared page, where they're someone else's).
export function renderCitations(html, { chatDate = () => '', linkChats = true } = {}) {
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
  const chatOf = (url) => chatLinkId(url, location.origin);
  const label = (url) => url.startsWith(DOCS_URL) ? 'Help center' : chatOf(url) ? (linkChats ? 'Your chat' : 'Earlier chat') : host(url);
  // Site icon, fetched through Proxi's own server so the icon service never sees the visitor's IP address.
  // This returns HTML text, so the icon is in the markup, hidden until the page-wide listener
  // below sees it load. The colored letter stays if it doesn't.
  const siteIcon = (name, url, cls) => {
    const el = document.createElement('span');
    if (chatOf(url)) {
      el.className = cls + ' src-chat';
      el.innerHTML = CHAT_ICON;
      return el;
    }
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
  const sources = list ? [...list.querySelectorAll('a')].map((a) => ({ url: a.getAttribute('href'), title: a.textContent })) : [];
  // A cited chat opens in Proxi itself (chat.js handles the click), not in a new tab.
  const link = (url, cls) => {
    const chat = chatOf(url);
    if (chat && !linkChats) {
      const span = document.createElement('span');
      span.className = cls;
      return span;
    }
    const a = document.createElement('a');
    a.href = url; a.className = cls;
    if (chat) a.dataset.chat = chat;
    else { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
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
  const count = sources.length === 1 ? '1 source' : sources.length + ' sources';
  const chevron = '<svg class="src-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>';
  summary.append(stack, count);
  summary.insertAdjacentHTML('beforeend', chevron);
  // The list opens on top of the chat: a card by the button, or a sheet from the bottom on phones.
  const panel = document.createElement('div');
  panel.className = 'src-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Sources');
  const head = document.createElement('div');
  head.className = 'src-head';
  const grab = document.createElement('span');
  grab.className = 'src-grab';
  grab.setAttribute('aria-hidden', 'true');
  const heading2 = document.createElement('span');
  heading2.className = 'src-heading';
  heading2.textContent = count;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'src-close';
  close.setAttribute('aria-label', 'Close sources');
  close.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  head.append(grab, heading2, close);
  const ul = document.createElement('ul');
  for (const src of sources) {
    const a = link(src.url, '');
    const name = label(src.url) || '?';
    const text = document.createElement('span');
    text.className = 'src-text';
    const title = document.createElement('span');
    title.className = 'src-title'; title.textContent = src.title;
    const site = document.createElement('span');
    const chat = chatOf(src.url);
    const when = chat && linkChats ? chatDate(chat) : '';
    site.className = 'src-site'; site.textContent = chat ? label(src.url) + (when ? ' · ' + when : '') : host(src.url);
    text.append(title, site);
    a.append(siteIcon(name, src.url, 'src-ico'), text);
    const li = document.createElement('li');
    li.append(a);
    ul.append(li);
  }
  panel.append(head, ul);
  details.append(summary, panel);
  heading.replaceWith(details);
  list.remove();
  return root.innerHTML;
}

// Whether the card fits below the button, or should open above it instead.
export function opensAbove(spaceBelow, spaceAbove, height) {
  return spaceBelow < height && spaceAbove > spaceBelow;
}

const PHONE = '(max-width: 640px)';

function closeSources(details, focus) {
  if (!details.open) return;
  details.open = false;
  if (focus) details.querySelector('summary')?.focus();
}

// Opens and closes source lists anywhere on the page: one at a time, closed by Esc, the close
// button, a click outside, or a swipe down on the phone sheet.
export function setupSources() {
  const openOnes = () => document.querySelectorAll('details.sources[open]');
  document.addEventListener('toggle', (e) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('sources') || !details.open) return;
    for (const other of openOnes()) if (other !== details) other.open = false;
    const panel = details.querySelector('.src-panel');
    panel.style.transform = '';
    details.classList.remove('src-up');
    if (matchMedia(PHONE).matches) return;
    // Measure against the scrolling area, so the card isn't cut off at its edge.
    let box = details.parentElement;
    while (box && box !== document.body && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    const area = box && box !== document.body ? box.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const btn = details.querySelector('summary').getBoundingClientRect();
    if (opensAbove(area.bottom - btn.bottom - 8, btn.top - area.top - 8, panel.offsetHeight)) details.classList.add('src-up');
  }, true);
  document.addEventListener('click', (e) => {
    const close = e.target.closest?.('.src-close');
    if (close) return closeSources(close.closest('details.sources'), true);
    for (const d of openOnes()) {
      // A click on the dimmed backdrop lands on the details element itself.
      if (!d.contains(e.target) || e.target === d) closeSources(d, false);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const d of openOnes()) closeSources(d, d.contains(document.activeElement));
  });
  // Swipe the phone sheet down to close it.
  let drag = null;
  document.addEventListener('touchstart', (e) => {
    const head = e.target.closest?.('.src-head');
    if (!head || !matchMedia(PHONE).matches) return;
    drag = { panel: head.parentElement, y: e.touches[0].clientY, dy: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
    drag.panel.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!drag) return;
    const { panel, dy } = drag;
    drag = null;
    panel.style.transform = '';
    if (dy > 60) closeSources(panel.closest('details.sources'), false);
  });
}
