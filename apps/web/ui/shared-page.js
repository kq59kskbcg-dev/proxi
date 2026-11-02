// The public page for a shared chat (/s/<id>). Plain DOM, no Vue and no sign-in.

import { api } from './api.js';
import { renderMarkdown } from './markdown.js';
import { maskCards } from './format.js';
import { renderCitations } from './citations.js';
import { KIND_LABELS } from './files.js';

// A shared chat (/s/<id>) is public: rendered without signing in and read-only.
export async function startShared(shareId) {
  document.title = 'Shared chat · Proxi';
  const root = document.getElementById('app');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const page = el('div', 'shared');
  const head = el('header', 'shared-head');
  const mark = el('a', 'shared-mark', 'proxi');
  mark.href = '/';
  const cta = el('a', 'shared-cta', 'Try Proxi');
  cta.href = '/';
  head.append(mark, cta);
  const body = el('main', 'shared-body');
  page.append(head, body);
  root.append(page);

  let chat = null;
  try {
    chat = await api.get('/api/shared', { query: { id: shareId }, auth: false });
  } catch (e) {}
  if (!chat || !Array.isArray(chat.messages)) {
    const empty = el('div', 'shared-empty');
    empty.append(el('h1', '', 'This link isn\u2019t available'), el('p', '', 'The chat was deleted, or its owner stopped sharing it.'));
    body.replaceWith(empty);
    return;
  }

  const top = el('div');
  top.append(el('h1', 'shared-title', chat.title),
    el('p', 'shared-meta', 'Shared chat · ' + new Date(chat.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })));
  body.append(top);
  for (const m of chat.messages) {
    if (m.role === 'user') {
      const wrap = el('div', 'shared-user');
      for (const a of m.attachments || []) wrap.append(el('div', 'shared-file', (KIND_LABELS[a.kind] || 'File') + ' attached'));
      if (m.content) wrap.append(el('div', 'shared-bubble', maskCards(m.content)));
      body.append(wrap);
    } else {
      const reply = el('article', 'shared-reply md');
      reply.innerHTML = renderCitations(renderMarkdown(m.content || ''));
      body.append(reply);
    }
  }
  page.append(el('p', 'shared-foot', 'Shared from Proxi. Messages appear as Proxi saw them, with sensitive data redacted.'));
}
