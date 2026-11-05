// A chat: opening it, sending, streaming the reply from /api/chat, and the messages with their
// actions (copy, edit, vote, regenerate). Also the chat's title menu in the header.

import { api, readProblem } from './api.js';
import { renderMarkdown } from './markdown.js';
import { maskCards, modelLabel } from './format.js';
import { renderCitations } from './citations.js';
import { toStep, stepIcon, redactionSteps, WORKING_VERBS } from './steps.js';
import { whenVisible } from './browser.js';
import { createReveal, createFadeTracker, applyFades, prefersReducedMotion } from './reveal.js';
import { ACCENT } from './store.js';
import { KIND_LABELS } from './files.js';
import { declinePending, memoryCard, MEMORY_ERRORS, MEMORY_MAX } from './memory-card.js';
import { MAX_MESSAGE_CHARS, MAX_CHAT_MESSAGES, MESSAGE_TOO_LONG, CHAT_FULL, CHAT_TOO_LARGE, RECOVER_MS, OWN_CARDS } from './limits.js';

export const chatState = {
  typing: false, // a reply is on its way
  typingConv: null,
  replyStarted: false,
  activity: [], // what Proxi did before the reply started
  verbTick: 0,
  copied: null, // the message whose Copy button shows a check
  votes: {},
  chatMenu: false,
  contactForms: {}, // message id -> what's typed in its "Message Lisandro" card: { email, error, sending, sentTo, dismissed }
  memoryForms: {} // message id -> its "Save to memory" card: { text, error, saving, duplicate }
};

// The same check as the server's, so a typo is caught before sending.
export const CONTACT_EMAIL = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,190}\.[A-Za-z]{2,24}$/;
export const CONTACT_ERRORS = {
  email: 'Enter a full email address, like name@example.com.',
  limit: "You've sent several messages in a short time. Try again later.",
  unavailable: "Messaging Lisandro isn't available right now. Email dealing-lignite-1z@icloud.com instead.",
  failed: "Couldn't send your message. Try again."
};

// The messages that are part of a chat. Error notices are shown to the user but never sent back.
function liveMessages(conv) {
  return conv.messages.filter((m) => !m.error && (m.text || (m.attachments || []).length || m.contact || m.memory));
}

// A message's rendered reply, kept until the message changes. Messages are replaced, never
// changed in place, so a streamed reply doesn't render every earlier message again.
const rendered = new WeakMap();
function replyHtml(m) {
  let html = rendered.get(m);
  if (html === undefined) {
    html = renderCitations(renderMarkdown(m.text || ''));
    rendered.set(m, html);
  }
  return html;
}

export function createChat(app) {
  const s = app.state;
  let abort = null; // the AbortController of the reply on its way
  let verbTimer = null;
  let msgEl = null;
  let msgObserver = null;
  let opened = '';
  let messageCount = 0;
  let atBottom = true;
  let reveal = null; // the buffer showing the reply on its way, word by word
  let liveId = null; // that reply's message, whose new words fade in
  const fades = createFadeTracker();

  function patchMessage(convId, msgId, fn) {
    app.setState((st) => ({
      convs: st.convs.map((c) => c.id !== convId ? c : { ...c, messages: c.messages.map((m) => m.id === msgId ? fn(m) : m) })
    }));
  }

  function addAssistant(convId, text) {
    const id = app.nextId();
    app.setState((st) => ({
      convs: st.convs.map((c) => c.id === convId ? { ...c, messages: [...c.messages, { id, role: 'assistant', text }] } : c)
    }));
    return id;
  }

  // Streams a real reply from /api/chat into the conversation.
  async function ask(convId) {
    const conv = s.convs.find((c) => c.id === convId);
    if (!conv) return;
    const live = liveMessages(conv);
    const messages = live.map((m, i) => ({
      role: m.role, content: m.text || '', model: m.model, traceId: m.traceId,
      ...(m.contact ? { contact: { summary: m.contact.summary, sent: !!m.contact.sent } } : {}),
      ...(m.memory ? { memory: { text: m.memory.text, status: m.memory.status } } : {}),
      attachments: (m.attachments || []).map((a) => (i === live.length - 1 && a.data ? { name: a.name, type: a.mediaType, data: a.data } : { kind: a.kind }))
    }));
    const controller = new AbortController();
    abort = controller;
    app.setState({ typing: true, typingConv: convId, replyStarted: false, activity: [], verbTick: 0 });
    // Rotates the "Thinking...", "Pondering..." label until the reply starts.
    clearInterval(verbTimer);
    verbTimer = setInterval(() => app.setState((st) => ({ verbTick: st.verbTick + 1 })), 1800);
    let msgId = null;
    let traceId = null;
    // Reply text goes through this buffer, so it appears word by word at a steady pace.
    const shown = createReveal({
      instant: prefersReducedMotion(),
      show: (text) => {
        startReply();
        patchMessage(convId, msgId, (m) => ({ ...m, text: m.text + text }));
      }
    });
    reveal = shown;
    fades.reset();
    // The reply's message, made when its first text or card arrives.
    const startReply = () => {
      if (msgId) return;
      msgId = addAssistant(convId, '');
      liveId = msgId;
      const steps = s.activity.map(toStep);
      patchMessage(convId, msgId, (m) => ({ ...m, traceId, steps }));
      clearInterval(verbTimer);
      app.setState({ replyStarted: true, activity: [] });
    };
    const finish = () => {
      if (abort === controller) abort = null;
      if (reveal === shown) { reveal = null; liveId = null; }
      clearInterval(verbTimer);
      app.setState({ typing: false, typingConv: null, replyStarted: false, activity: [] });
    };
    // A card has a title, a sentence and a Try again button. Text-only errors (a declined request, an
    // attachment problem) are shown as plain text.
    const fail = ({ text, card }) => {
      if (card) {
        if (msgId) patchMessage(convId, msgId, (m) => ({ ...m, card, error: true }));
        else { const id = addAssistant(convId, ''); patchMessage(convId, id, (m) => ({ ...m, card, error: true })); }
      } else if (msgId) patchMessage(convId, msgId, (m) => ({ ...m, text: m.text ? m.text + '\n\n' + text : text, error: true }));
      else { const id = addAssistant(convId, text); patchMessage(convId, id, (m) => ({ ...m, error: true })); }
    };
    try {
      const payload = JSON.stringify({ model: s.model, messages, conversationId: convId, temporary: !!conv.temporary, escalated: !!conv.escalated });
      // The host rejects request bodies over 4.5 MB, so say so before sending.
      if (payload.length > 4400000) {
        fail({ text: CHAT_TOO_LARGE });
        return finish();
      }
      const res = await api.post('/api/chat', payload, { raw: true, signal: controller.signal });
      if (!res.ok || !res.body) {
        fail(await readProblem(res));
        return finish();
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === 'start') {
            traceId = event.traceId;
            // Once someone asks for a person, later messages in the chat can still get the card.
            if (event.escalated) app.setState((st) => ({ convs: st.convs.map((c) => c.id === convId ? { ...c, escalated: true } : c) }));
            // What Proxi did before sending goes in the reply's timeline, not a toast.
            const entries = redactionSteps(event.redactions).concat((event.notices || []).map((n) => ({ done: 'Checked attachments', detail: n, icon: 'file' })));
            if (entries.length) app.setState((st) => ({ activity: [...st.activity, ...entries] }));
          } else if (event.type === 'activity') {
            // A tool call. Before the reply starts it's shown live; after, it's added to the reply's steps.
            if (msgId) patchMessage(convId, msgId, (m) => ({ ...m, steps: [...(m.steps || []), toStep(event)] }));
            else app.setState((st) => ({ activity: [...st.activity, event] }));
          } else if (event.type === 'text') {
            shown.push(event.text);
          } else if (event.type === 'contact') {
            // Cards come after the text before them has been shown.
            await shown.idle();
            startReply();
            patchMessage(convId, msgId, (m) => ({ ...m, contact: { summary: event.summary, sent: false } }));
          } else if (event.type === 'memory') {
            await shown.idle();
            startReply();
            patchMessage(convId, msgId, (m) => ({ ...m, memory: { text: event.text, status: 'pending' } }));
          } else if (event.type === 'done') {
            if (msgId) patchMessage(convId, msgId, (m) => ({ ...m, model: event.model }));
          } else if (event.type === 'title') {
            app.setState((st) => ({ convs: st.convs.map((c) => c.id === convId ? { ...c, title: event.title } : c) }));
          } else if (event.type === 'error') {
            await shown.idle();
            fail(event.card ? { card: event.card } : { text: event.error });
          }
        }
      }
      // The reply is finished once its last word is on screen; Stop stays until then.
      await shown.idle();
    } catch (e) {
      if (!controller.signal.aborted) {
        // Switching tabs can make the browser drop the connection while Proxi keeps going and saves
        // the reply. In a saved chat, wait for that reply instead of showing an error.
        const saved = conv.temporary || !traceId ? null : await savedReply(convId, traceId, controller);
        if (saved) { shown.drop(); placeReply(convId, msgId, saved); }
        else if (!controller.signal.aborted) { shown.flush(); fail({ card: { ...OWN_CARDS.network, ref: 'network' } }); }
      }
    }
    finish();
  }

  // The reply the server saved for this request, matched by its trace ID so an older reply (before
  // a Regenerate, say) is never taken for it. Checks once the page is showing, every 2 seconds.
  async function savedReply(convId, traceId, controller) {
    await whenVisible();
    const until = Date.now() + RECOVER_MS;
    while (Date.now() < until && !controller.signal.aborted) {
      try {
        const { messages } = await api.get('/api/conversations', { query: { id: convId } });
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant' && last.traceId === traceId) return last;
      } catch (e) {}
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
  }

  // Puts a recovered reply where the interrupted one was, or adds it.
  function placeReply(convId, msgId, saved) {
    const reply = { text: saved.content, model: saved.model, traceId: saved.traceId, error: false, card: null };
    if (msgId) patchMessage(convId, msgId, (m) => ({ ...m, ...reply }));
    else { const id = addAssistant(convId, ''); patchMessage(convId, id, (m) => ({ ...m, ...reply })); }
  }

  async function openConversation(id) {
    app.go({ view: 'chat', activeId: id });
    const conv = s.convs.find((c) => c.id === id);
    if (!conv || conv.loaded || conv.loading) return;
    const patch = (fields) => app.setState((st) => ({ convs: st.convs.map((c) => c.id === id ? { ...c, ...fields } : c) }));
    patch({ loading: true });
    try {
      const { messages } = await api.get('/api/conversations', { query: { id } });
      patch({ loading: false, loaded: true, messages: messages.map((m) => ({ id: app.nextId(), role: m.role, text: m.content, model: m.model, traceId: m.traceId, attachments: (m.attachments || []).map((a) => ({ kind: a.kind })), ...(m.contact ? { contact: m.contact } : {}), ...(m.memory ? { memory: m.memory } : {}) })) });
    } catch (e) {
      patch({ loading: false });
      app.showToast("Couldn't open this chat. Try again.");
    }
  }

  function send(raw) {
    const text = (raw != null ? raw : s.draft).trim();
    const files = s.pending;
    if ((!text && !files.length) || s.typing || s.reading) return;
    if (text.length > MAX_MESSAGE_CHARS) return app.showToast(MESSAGE_TOO_LONG);
    const id = app.nextId();
    let convId = s.view === 'chat' ? s.activeId : null;
    const current = s.convs.find((c) => c.id === convId);
    // Never send from a half-loaded chat: saving it would drop its earlier messages.
    if (current && !current.loaded) return;
    // A chat holds up to 100 of your messages; the draft stays in the box.
    if (current && liveMessages(current).length + 1 > MAX_CHAT_MESSAGES) return app.showToast(CHAT_FULL);
    let fresh = null;
    if (!convId) {
      convId = crypto.randomUUID();
      const title = maskCards(text);
      fresh = { id: convId, updatedAt: new Date().toISOString(), title: title ? (title.length > 40 ? title.slice(0, 40).trim() + '...' : title) : 'Attachment', group: 'Today', messages: [], loaded: true, temporary: s.temporary };
    }
    app.setState((st) => {
      // The active chat moves to the top of Today.
      const base = fresh ? [fresh, ...st.convs] : [{ ...current, group: 'Today', updatedAt: new Date().toISOString() }, ...st.convs.filter((c) => c.id !== convId)];
      return {
        draft: '',
        pending: [],
        view: 'chat',
        activeId: convId,
        modelMenu: false,
        // A "Save to memory" card left unanswered counts as declined once another message is sent.
        convs: base.map((c) => c.id === convId ? { ...c, messages: [...declinePending(c.messages), { id, role: 'user', text, attachments: files }] } : c)
      };
    });
    ask(convId);
  }

  function stop() {
    // Stop shows everything received so far at once.
    if (reveal) reveal.flush();
    if (abort) { abort.abort(); abort = null; }
    app.setState({ typing: false, typingConv: null, replyStarted: false });
  }

  function truncateAt(msgId) {
    app.setState((st) => ({
      convs: st.convs.map((c) => {
        if (c.id !== st.activeId) return c;
        const i = c.messages.findIndex((m) => m.id === msgId);
        return i < 0 ? c : { ...c, messages: c.messages.slice(0, i) };
      })
    }));
  }

  function edit(msg) {
    stop();
    truncateAt(msg.id);
    app.setState({ draft: msg.text, pending: (msg.attachments || []).filter((a) => a.data) });
    app.focusComposer();
  }

  function regen(msg) {
    if (s.typing) return;
    truncateAt(msg.id);
    ask(s.activeId);
  }

  function copy(key, text) {
    app.copyText(text);
    app.setState({ copied: key });
    app.later(() => app.setState((st) => (st.copied === key ? { copied: null } : null)), 1500);
  }

  function vote(m, dir) {
    const next = s.votes[m.id] === dir ? null : dir;
    app.setState((st) => ({ votes: { ...st.votes, [m.id]: next } }));
    if (m.traceId) {
      // Fire and forget: a vote that doesn't arrive isn't worth interrupting anyone for.
      api.post('/api/feedback', { traceId: m.traceId, value: next === 'up' ? 1 : next === 'down' ? 0 : null }).catch(() => {});
    }
  }

  function setForm(msgId, fields) {
    app.setState((st) => ({ contactForms: { ...st.contactForms, [msgId]: { ...(st.contactForms[msgId] || {}), ...fields } } }));
  }

  // The Send button of a "Message Lisandro" card.
  async function sendContact(m) {
    const conv = app.activeConv.value;
    const form = s.contactForms[m.id] || {};
    const email = (form.email || '').trim();
    if (!conv || form.sending) return;
    if (!CONTACT_EMAIL.test(email)) return setForm(m.id, { error: CONTACT_ERRORS.email });
    setForm(m.id, { sending: true, error: '' });
    // Where the reply is in the saved chat, so the server can mark its card as sent.
    const position = liveMessages(conv).findIndex((x) => x.id === m.id);
    const body = { summary: m.contact.summary, replyTo: email, ...(conv.temporary || position < 0 ? {} : { conversationId: conv.id, position }) };
    try {
      await api.post('/api/contact', body);
      patchMessage(conv.id, m.id, (x) => ({ ...x, contact: { ...x.contact, sent: true } }));
      setForm(m.id, { sending: false, sentTo: email });
    } catch (e) {
      const code = e && e.data && e.data.error;
      setForm(m.id, { sending: false, error: CONTACT_ERRORS[code] || CONTACT_ERRORS.failed });
    }
  }

  function setMemoryForm(msgId, fields) {
    app.setState((st) => ({ memoryForms: { ...st.memoryForms, [msgId]: { ...(st.memoryForms[msgId] || {}), ...fields } } }));
  }

  // Where a reply is in the saved chat, so the server can mark its card; none in incognito chats.
  function cardPlace(conv, m) {
    const position = liveMessages(conv).findIndex((x) => x.id === m.id);
    return conv.temporary || position < 0 ? {} : { conversationId: conv.id, position };
  }

  // The Save button of a "Save to memory" card. Saves the text as it is in the card.
  async function saveMemory(m) {
    const conv = app.activeConv.value;
    const form = s.memoryForms[m.id] || {};
    const text = (form.text != null ? form.text : m.memory.text).trim();
    if (!conv || form.saving) return;
    if (!text || text.length > MEMORY_MAX) return setMemoryForm(m.id, { error: MEMORY_ERRORS.invalid });
    setMemoryForm(m.id, { saving: true, error: '' });
    try {
      const res = await api.post('/api/memories', { text, ...cardPlace(conv, m) });
      patchMessage(conv.id, m.id, (x) => ({ ...x, memory: { text: res.text || text, status: 'saved' } }));
      setMemoryForm(m.id, { saving: false, duplicate: res.outcome === 'duplicate' });
    } catch (e) {
      const code = e && e.data && e.data.error;
      setMemoryForm(m.id, { saving: false, error: MEMORY_ERRORS[code] || MEMORY_ERRORS.failed });
    }
  }

  // The Not now button: nothing is saved, and the card becomes a quiet "Not saved to memory" line.
  function declineMemory(m) {
    const conv = app.activeConv.value;
    if (!conv) return;
    patchMessage(conv.id, m.id, (x) => ({ ...x, memory: { ...x.memory, status: 'declined' } }));
    const place = cardPlace(conv, m);
    // If this doesn't arrive, the card is marked declined anyway when the next message is sent.
    if (place.conversationId) api.patch('/api/memories', place).catch(() => {});
  }

  async function deleteChat() {
    const id = s.activeId;
    stop();
    app.setState((st) => ({ convs: st.convs.filter((c) => c.id !== id), activeId: null, view: 'new', chatMenu: false }));
    try {
      const res = await api.delete('/api/conversations', { query: { id }, raw: true });
      app.showToast(res.ok || res.status === 503 ? 'Chat deleted' : "Couldn't delete the chat");
    } catch (e) {
      app.showToast("Couldn't delete the chat");
    }
  }

  // Follow new content only while the reader is at the bottom. Opening a chat or
  // sending a message always jumps to the bottom; a reply that arrives while
  // someone is reading older messages does not pull them away.
  function followBottom() {
    const el = msgEl;
    if (!el) return;
    const conv = app.activeConv.value;
    const messages = conv ? conv.messages : [];
    const last = messages[messages.length - 1];
    const now = s.view + ':' + s.activeId;
    if (now !== opened) {
      opened = now;
      atBottom = true;
    } else if (messages.length !== messageCount && last && last.role === 'user') {
      atBottom = true;
    }
    messageCount = messages.length;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  // The reply on its way is rendered again for each word; this fades in only the newest words.
  function fadeLive() {
    if (!liveId || !msgEl || prefersReducedMotion()) return;
    const el = msgEl.querySelector('.md[data-mid="' + liveId + '"]');
    // A marker at the end tells whether this render was already handled.
    if (!el || (el._fadeMark && el._fadeMark === el.lastChild)) return;
    applyFades(el, fades.update(el.textContent.length));
    el._fadeMark = el.appendChild(document.createComment(''));
  }

  const msgRef = (el) => {
    if (el === msgEl) return;
    msgEl = el;
    // When the list's height changes (keyboard, attachments, rotation), stay at the bottom if we were there.
    if (msgObserver) msgObserver.disconnect();
    if (el && window.ResizeObserver) {
      msgObserver = new ResizeObserver(() => { if (atBottom) el.scrollTop = el.scrollHeight; });
      msgObserver.observe(el);
    }
  };
  const onMsgScroll = () => {
    if (msgEl) atBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 80;
  };

  return {
    actions: { openConversation, send, stop },
    updated() { followBottom(); fadeLive(); },
    unmounted() {
      if (msgObserver) msgObserver.disconnect();
    },

    views: {
      chatHeader: () => {
        const conv = app.activeConv.value;
        return {
          chatTitle: conv ? (conv.temporary ? 'Incognito chat' : conv.title) : '',
          chatMenu: s.chatMenu,
          chatMenuExpanded: s.chatMenu ? 'true' : 'false',
          toggleChatMenu: () => app.setState({ chatMenu: !s.chatMenu, shareMenu: false, modelMenu: false, userMenu: false }),
          deleteChat
        };
      },

      messages: () => {
        const conv = app.activeConv.value;
        // The reply still appearing gets its Copy, rating and Regenerate buttons once it's finished.
        const streaming = s.typing && s.typingConv === conv?.id;
        const lastIndex = conv ? conv.messages.length - 1 : -1;
        const msgs = app.isChat.value ? conv.messages.map((m, i) => {
          const v = s.votes[m.id];
          const key = 'm' + m.id;
          const copied = s.copied === key;
          const shown = m.role === 'user' ? maskCards(m.text || '') : m.text || '';
          return {
            mid: m.id,
            text: shown,
            attachments: (m.attachments || []).map((a, i) => ({
              key: i, thumb: a.data ? a.thumb : '', muted: !a.data,
              label: a.data ? a.name : KIND_LABELS[a.kind] + ' removed'
            })),
            isUser: m.role === 'user',
            isAssistant: m.role === 'assistant',
            showActions: !(streaming && i === lastIndex && m.role === 'assistant'),
            hasSteps: !!(m.steps && m.steps.length),
            steps: [...new Set((m.steps || []).map((st) => st.short))].join(' · '),
            stepList: [...(m.steps || []), ...(m.model ? [{ text: 'Answered with ' + modelLabel(m.model), icon: 'spark' }] : [])].map((st, i) => ({ key: i, text: st.text, icon: stepIcon(st.icon) })),
            canVote: !conv.temporary,
            html: m.role === 'assistant' ? replyHtml(m) : '',
            copied,
            notCopied: !copied,
            copyLabel: copied ? 'Copied' : (m.role === 'user' ? 'Copy message' : 'Copy response'),
            upPressed: v === 'up' ? 'true' : 'false',
            downPressed: v === 'down' ? 'true' : 'false',
            upColor: v === 'up' ? ACCENT : 'var(--text-muted-3)',
            downColor: v === 'down' ? ACCENT : 'var(--text-muted-3)',
            upFill: v === 'up' ? 'currentColor' : 'none',
            downFill: v === 'down' ? 'currentColor' : 'none',
            onCopy: () => copy(key, shown),
            onEdit: () => edit(m),
            onUp: () => vote(m, 'up'),
            onDown: () => vote(m, 'down'),
            onRegen: () => regen(m),
            isErrorCard: !!m.card,
            cardTitle: m.card ? m.card.title : '',
            cardBody: m.card ? m.card.body : '',
            cardRef: m.card ? m.card.ref : '',
            // Try again replaces the failed reply, the same as Regenerate.
            onRetry: () => regen(m),
            ...contactView(m),
            ...memoryView(m)
          };
        }) : [];
        return { msgRef, onMsgScroll, msgs };
        // The reply's "Message Lisandro" card: a form until it's sent, then a confirmation.
        function contactView(m) {
          const form = s.contactForms[m.id] || {};
          const show = !!(m.contact && m.contact.summary) && !(form.dismissed && !m.contact.sent);
          const sent = show && !!m.contact.sent;
          return {
            hasContact: show,
            contactSent: sent,
            contactForm: show && !sent,
            contactSummary: show ? m.contact.summary : '',
            contactDone: form.sentTo ? 'He\'ll reply to ' + form.sentTo + '.' : 'He\'ll reply by email.',
            contactInput: 'contact-email-' + m.id,
            contactTitle: 'contact-title-' + m.id,
            contactErrorId: 'contact-error-' + m.id,
            contactEmail: form.email || '',
            contactError: form.error || '',
            contactInvalid: form.error ? 'true' : 'false',
            // Not while the reply is still arriving: it's saved when it ends.
            contactBusy: !!form.sending || (s.typing && s.typingConv === conv.id),
            contactSendLabel: form.sending ? 'Sending...' : 'Send',
            onContactEmail: (e) => setForm(m.id, { email: e.target.value, error: '' }),
            onContactKey: (e) => { if (e.key === 'Enter') { e.preventDefault(); sendContact(m); } },
            onContactSend: () => sendContact(m),
            onContactDismiss: () => setForm(m.id, { dismissed: true })
          };
        }
        // The reply's "Save to memory" card. Not answerable while the reply is still arriving: it's saved when it ends.
        function memoryView(m) {
          const form = s.memoryForms[m.id] || {};
          return {
            ...memoryCard(m.memory, form, s.typing && s.typingConv === conv.id),
            memoryInput: 'memory-text-' + m.id,
            memoryTitle: 'memory-title-' + m.id,
            memoryHintId: 'memory-hint-' + m.id,
            memoryMax: MEMORY_MAX,
            memoryInvalid: form.error ? 'true' : 'false',
            onMemoryText: (e) => setMemoryForm(m.id, { text: e.target.value, error: '' }),
            onMemorySave: () => saveMemory(m),
            onMemoryDismiss: () => declineMemory(m)
          };
        }
      },

      // The "Thinking..." line, apart from the messages so its rotating label doesn't rebuild them.
      typingIndicator: () => {
        const conv = app.activeConv.value;
        const liveStep = [...s.activity].reverse().find((a) => a.label);
        return {
          workingLabel: conv && conv.loading ? 'Loading' : liveStep ? liveStep.label : WORKING_VERBS[s.verbTick % WORKING_VERBS.length],
          showTyping: app.isChat.value && ((s.typing && !s.replyStarted && s.typingConv === s.activeId) || !!conv.loading)
        };
      }
    }
  };
}
