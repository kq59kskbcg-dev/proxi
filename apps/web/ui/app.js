// The Proxi app: a React-style class component rendered through Vue, plus the shared-chat page.
// Vue, Clerk and the theme helper are globals set up by index.html before this module runs.

import { renderMarkdown } from './markdown.js';
import { highlight, groupOf, fullDate, shareUrl, maskCards, modelLabel } from './format.js';
import { renderCitations, DOCS_URL } from './citations.js';
import { toStep, stepIcon, redactionSteps, WORKING_VERBS } from './steps.js';
import { privacyView } from './privacy.js';
import { trackViewport, whenVisible, authHeaders } from './browser.js';
import { MAX_MESSAGE_CHARS, MAX_CHAT_MESSAGES, MESSAGE_TOO_LONG, CHAT_FULL, CHAT_TOO_LARGE, RECOVER_MS, OWN_CARDS } from './limits.js';
import { MAX_FILES, MAX_TOTAL, MAX_TEXT, ACCEPT, KIND_LABELS, classify, formatSize, readBase64, makeThumb } from './files.js';

// Minimal stand-in for the Design canvas runtime: a React-style class
// component (state, setState, lifecycle) rendered through Vue.
const { createApp, ref, computed, onMounted, onUpdated, onBeforeUnmount } = Vue;

const RECENTS_SHOWN = 10; // chats listed in the sidebar; "View all" opens search

class DCLogic {
  constructor(props) { this.props = props; }
  setState(update) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    if (!patch) return;
    this.state = { ...this.state, ...patch };
    this.tick.value++;
  }
}

class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.nextId = 100;
    this.timers = [];
    this.sig = '';
    this.state = {
      convs: [],
      activeId: null,
      view: 'new',
      draft: '',
      composerTall: false,
      typing: false,
      typingConv: null,
      replyStarted: false,
      activity: [],
      verbTick: 0,
      pending: [],
      reading: false,
      history: 'loading',
      dragging: false,
      model: 'Auto',
      modelMenu: false,
      chatMenu: false,
      shareMenu: false,
      userMenu: false,
      searchOpen: false,
      query: '',
      searchSel: 0,
      collapsed: false,
      narrowNav: false,
      copied: null,
      toast: '',
      settings: null,
      settingsBusy: false,
      deleteAccountOpen: false,
      deletingAccount: false,
      instructionsDraft: '',
      memories: null,
      privacy: null,
      privacyPeriod: 'month',
      theme: window.proxiTheme?.get() || 'system',
      temporary: false,
      votes: {}
    };
  }

  componentDidMount() {
    this.loadConversations();
    this.onGlobalKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (this.state.searchOpen) this.closeSearch(); else this.openSearch();
      }
    };
    window.addEventListener('keydown', this.onGlobalKey);
    // Crossing the mobile breakpoint: close the mobile menu and skip the slide animations.
    try {
      this.mq = window.matchMedia('(max-width: 830px)');
      this.onBreakpoint = () => {
        document.documentElement.classList.add('resizing');
        this.setState({ narrowNav: false });
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => document.documentElement.classList.remove('resizing'), 350);
      };
      this.mq.addEventListener('change', this.onBreakpoint);
    } catch (e) {}
  }

  componentWillUnmount() {
    this.timers.forEach((t) => clearTimeout(t));
    if (this.mq) this.mq.removeEventListener('change', this.onBreakpoint);
    window.removeEventListener('keydown', this.onGlobalKey);
    if (this.msgObserver) this.msgObserver.disconnect();
  }

  // Follow new content only while the reader is at the bottom. Opening a chat or
  // sending a message always jumps to the bottom; a reply that arrives while
  // someone is reading older messages does not pull them away.
  // The message box starts as one line next to its buttons. Once the text wraps
  // it takes the full width (buttons move below) and grows up to 8 lines.
  sizeComposer() {
    const ta = this.taEl;
    if (!ta) return;
    const line = 24, max = line * 8 + 20;
    if (!this.state.draft) {
      ta.style.height = '44px';
      ta.style.overflowY = 'hidden';
      if (this.state.composerTall) this.setState({ composerTall: false });
      return;
    }
    ta.style.height = 'auto';
    const h = ta.scrollHeight;
    ta.style.height = Math.min(Math.max(h, 44), max) + 'px';
    ta.style.overflowY = h > max ? 'auto' : 'hidden';
    const tall = this.state.draft.includes('\n') || h > 44 + 4;
    if (tall && !this.state.composerTall) this.setState({ composerTall: true });
  }

  componentDidUpdate() {
    this.sizeComposer();
    const el = this.msgEl;
    if (!el) return;
    const conv = this.state.convs.find((c) => c.id === this.state.activeId);
    const messages = conv ? conv.messages : [];
    const last = messages[messages.length - 1];
    const opened = this.state.view + ':' + this.state.activeId;
    if (opened !== this.opened) {
      this.opened = opened;
      this.atBottom = true;
    } else if (messages.length !== this.messageCount && last && last.role === 'user') {
      this.atBottom = true;
    }
    this.messageCount = messages.length;
    if (this.atBottom) el.scrollTop = el.scrollHeight;
  }

  onMsgScroll() {
    const el = this.msgEl;
    if (el) this.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      fn();
    }, ms);
    this.timers.push(t);
    return t;
  }

  isNarrow() {
    try { return window.matchMedia('(max-width: 830px)').matches; } catch (e) { return false; }
  }

  focusComposer() {
    setTimeout(() => { if (this.taEl) this.taEl.focus(); }, 0);
  }

  showToast(text) {
    clearTimeout(this.toastTimer);
    this.setState({ toast: text });
    this.toastTimer = this.later(() => this.setState({ toast: '' }), Math.min(8000, Math.max(2200, text.length * 55)));
  }

  patchMessage(convId, msgId, fn) {
    this.setState((s) => ({
      convs: s.convs.map((c) => c.id !== convId ? c : { ...c, messages: c.messages.map((m) => m.id === msgId ? fn(m) : m) })
    }));
  }

  addAssistant(convId, text) {
    const id = this.nextId++;
    this.setState((s) => ({
      convs: s.convs.map((c) => c.id === convId ? { ...c, messages: [...c.messages, { id, role: 'assistant', text }] } : c)
    }));
    return id;
  }

  // Why a file can't be added, or '' if it can.
  fileProblem(file, pending) {
    if (/\.(docx?|xlsx?|pptx?)$/i.test(file.name)) return "Word, Excel and PowerPoint files aren't supported yet. Try a PDF or plain text.";
    const kind = classify(file);
    if (!kind) return file.name + " isn't supported. Attach images, PDFs or plain text files.";
    if (file.size === 0) return file.name + ' is empty.';
    if (pending.length >= MAX_FILES) return 'You can attach up to ' + MAX_FILES + ' files per message.';
    if (kind === 'text' && file.size > MAX_TEXT) return file.name + ' is too large. Text files can be up to 200 KB.';
    if (pending.reduce((sum, a) => sum + a.bytes, 0) + file.size > MAX_TOTAL) return 'Attachments can be up to 3 MB in total.';
    return '';
  }

  async addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    this.setState({ reading: true });
    const pending = this.state.pending.slice();
    try {
      for (const file of files) {
        const problem = this.fileProblem(file, pending);
        if (problem) { this.showToast(problem); continue; }
        const kind = classify(file);
        pending.push({
          id: this.nextId++, name: file.name || 'file', kind, bytes: file.size,
          mediaType: kind === 'image' ? file.type : kind === 'pdf' ? 'application/pdf' : 'text/plain',
          data: await readBase64(file), thumb: kind === 'image' ? await makeThumb(file) : ''
        });
      }
    } catch (e) {
      this.showToast("Couldn't read that file. Please try again.");
    }
    this.setState({ pending, reading: false });
    this.focusComposer();
  }

  // The messages that are part of a chat. Error notices are shown to the user but never sent back.
  liveMessages(conv) {
    return conv.messages.filter((m) => !m.error && (m.text || (m.attachments || []).length));
  }

  // Streams a real reply from /api/chat into the conversation.
  async ask(convId) {
    const conv = this.state.convs.find((c) => c.id === convId);
    if (!conv) return;
    const live = this.liveMessages(conv);
    const messages = live.map((m, i) => ({
      role: m.role, content: m.text || '', model: m.model, traceId: m.traceId,
      attachments: (m.attachments || []).map((a) => (i === live.length - 1 && a.data ? { name: a.name, type: a.mediaType, data: a.data } : { kind: a.kind }))
    }));
    const controller = new AbortController();
    this.abort = controller;
    this.setState({ typing: true, typingConv: convId, replyStarted: false, activity: [], verbTick: 0 });
    // Rotates the "Thinking...", "Pondering..." label until the reply starts.
    clearInterval(this.verbTimer);
    this.verbTimer = setInterval(() => this.setState((s) => ({ verbTick: s.verbTick + 1 })), 1800);
    let msgId = null;
    let traceId = null;
    const finish = () => {
      if (this.abort === controller) this.abort = null;
      clearInterval(this.verbTimer);
      this.setState({ typing: false, typingConv: null, replyStarted: false, activity: [] });
    };
    // A card has a title, a sentence and a Try again button. Text-only errors (a declined request, an
    // attachment problem) are shown as plain text.
    const fail = ({ text, card }) => {
      if (card) {
        if (msgId) this.patchMessage(convId, msgId, (m) => ({ ...m, card, error: true }));
        else { const id = this.addAssistant(convId, ''); this.patchMessage(convId, id, (m) => ({ ...m, card, error: true })); }
      } else if (msgId) this.patchMessage(convId, msgId, (m) => ({ ...m, text: m.text ? m.text + '\n\n' + text : text, error: true }));
      else { const id = this.addAssistant(convId, text); this.patchMessage(convId, id, (m) => ({ ...m, error: true })); }
    };
    try {
      const payload = JSON.stringify({ model: this.state.model, messages, conversationId: convId, temporary: !!conv.temporary });
      // The host rejects request bodies over 4.5 MB, so say so before sending.
      if (payload.length > 4400000) {
        fail({ text: CHAT_TOO_LARGE });
        return finish();
      }
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: await authHeaders(),
        body: payload,
        signal: controller.signal
      });
      if (!res.ok || !res.body) {
        let problem = res.status === 413 ? { text: CHAT_TOO_LARGE } : { card: { ...OWN_CARDS.error, ref: String(res.status) } };
        try {
          const data = await res.json();
          if (data.card) problem = { card: data.card };
          else if (data.error) problem = { text: data.error };
        } catch (e) {}
        fail(problem);
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
            // What Proxi did before sending goes in the reply's timeline, not a toast.
            const entries = redactionSteps(event.redactions).concat((event.notices || []).map((n) => ({ done: 'Checked attachments', detail: n, icon: 'file' })));
            if (entries.length) this.setState((s) => ({ activity: [...s.activity, ...entries] }));
          } else if (event.type === 'activity') {
            // A tool call. Before the reply starts it's shown live; after, it's added to the reply's steps.
            if (msgId) this.patchMessage(convId, msgId, (m) => ({ ...m, steps: [...(m.steps || []), toStep(event)] }));
            else this.setState((s) => ({ activity: [...s.activity, event] }));
          } else if (event.type === 'text') {
            if (!msgId) {
              msgId = this.addAssistant(convId, '');
              const steps = this.state.activity.map(toStep);
              this.patchMessage(convId, msgId, (m) => ({ ...m, traceId, steps }));
              clearInterval(this.verbTimer);
              this.setState({ replyStarted: true, activity: [] });
            }
            this.patchMessage(convId, msgId, (m) => ({ ...m, text: m.text + event.text }));
          } else if (event.type === 'done') {
            if (msgId) this.patchMessage(convId, msgId, (m) => ({ ...m, model: event.model }));
          } else if (event.type === 'title') {
            this.setState((s) => ({ convs: s.convs.map((c) => c.id === convId ? { ...c, title: event.title } : c) }));
          } else if (event.type === 'error') {
            fail(event.card ? { card: event.card } : { text: event.error });
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        // Switching tabs can make the browser drop the connection while Proxi keeps going and saves
        // the reply. In a saved chat, wait for that reply instead of showing an error.
        const saved = conv.temporary || !traceId ? null : await this.savedReply(convId, traceId, controller);
        if (saved) this.placeReply(convId, msgId, saved);
        else if (!controller.signal.aborted) fail({ card: { ...OWN_CARDS.network, ref: 'network' } });
      }
    }
    finish();
  }

  // The reply the server saved for this request, matched by its trace ID so an older reply (before
  // a Regenerate, say) is never taken for it. Checks once the page is showing, every 2 seconds.
  async savedReply(convId, traceId, controller) {
    await whenVisible();
    const until = Date.now() + RECOVER_MS;
    while (Date.now() < until && !controller.signal.aborted) {
      try {
        const res = await fetch('/api/conversations?id=' + encodeURIComponent(convId), { headers: await authHeaders() });
        if (res.ok) {
          const { messages } = await res.json();
          const last = messages[messages.length - 1];
          if (last && last.role === 'assistant' && last.traceId === traceId) return last;
        }
      } catch (e) {}
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
  }

  // Puts a recovered reply where the interrupted one was, or adds it.
  placeReply(convId, msgId, saved) {
    const reply = { text: saved.content, model: saved.model, traceId: saved.traceId, error: false, card: null };
    if (msgId) this.patchMessage(convId, msgId, (m) => ({ ...m, ...reply }));
    else { const id = this.addAssistant(convId, ''); this.patchMessage(convId, id, (m) => ({ ...m, ...reply })); }
  }

  // The signed-in user's saved chats, newest first. Messages load when a chat is opened.
  async loadConversations() {
    this.setState({ history: 'loading' });
    try {
      const res = await fetch('/api/conversations', { headers: await authHeaders() });
      if (res.status === 503) return this.setState({ history: 'off' });
      if (!res.ok) {
        let detail = {};
        try { detail = await res.json(); } catch (e) {}
        // A short, safe reference (status and database error code) to help find the cause.
        return this.setState({ history: 'error', historyRef: [res.status, detail.code || detail.kind].filter(Boolean).join(' · ') });
      }
      const { conversations } = await res.json();
      const today = new Date().toDateString();
      this.setState((s) => {
        const known = new Set(s.convs.map((c) => c.id));
        const saved = conversations.filter((c) => !known.has(c.id)).map((c) => ({
          id: c.id, title: c.title, updatedAt: c.updatedAt, group: new Date(c.updatedAt).toDateString() === today ? 'Today' : 'Earlier', messages: [], loaded: false, shareId: c.shareId || null
        }));
        return { convs: [...s.convs, ...saved], history: 'ok' };
      });
    } catch (e) {
      console.error('Loading chats failed:', e);
      this.setState({ history: 'error', historyRef: 'network' });
    }
  }

  // ---- Chat search ----
  openSearch() {
    this.returnFocus = document.activeElement;
    this.searchNeedsFocus = true;
    this.go({ searchOpen: true, query: '', searchSel: 0 });
    this.later(() => { if (this.searchEl) this.searchEl.focus(); }, 0);
  }

  closeSearch() {
    this.setState({ searchOpen: false, query: '', searchSel: 0 });
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && back.focus) this.later(() => back.focus(), 0);
  }

  searchMatches() {
    const q = this.state.query.trim().toLowerCase();
    return this.state.convs.filter((c) => !c.temporary && (!q || c.title.toLowerCase().includes(q))).slice(0, 200);
  }

  pickSearchResult(id) {
    this.setState({ searchOpen: false, query: '', searchSel: 0 });
    this.returnFocus = null;
    this.openConversation(id);
  }

  onSearchKey(e) {
    const count = this.searchMatches().length;
    if (e.key === 'Escape') { e.preventDefault(); this.closeSearch(); }
    else if (e.key === 'ArrowDown' && count) { e.preventDefault(); this.setState({ searchSel: (this.state.searchSel + 1) % count }); }
    else if (e.key === 'ArrowUp' && count) { e.preventDefault(); this.setState({ searchSel: (this.state.searchSel - 1 + count) % count }); }
    else if (e.key === 'Enter' && count) {
      e.preventDefault();
      const pick = this.searchMatches()[Math.min(this.state.searchSel, count - 1)];
      if (pick) this.pickSearchResult(pick.id);
    }
  }

  async openConversation(id) {
    this.go({ view: 'chat', activeId: id });
    const conv = this.state.convs.find((c) => c.id === id);
    if (!conv || conv.loaded || conv.loading) return;
    const patch = (fields) => this.setState((s) => ({ convs: s.convs.map((c) => c.id === id ? { ...c, ...fields } : c) }));
    patch({ loading: true });
    try {
      const res = await fetch('/api/conversations?id=' + encodeURIComponent(id), { headers: await authHeaders() });
      if (!res.ok) throw new Error(res.status);
      const { messages } = await res.json();
      patch({ loading: false, loaded: true, messages: messages.map((m) => ({ id: this.nextId++, role: m.role, text: m.content, model: m.model, traceId: m.traceId, attachments: (m.attachments || []).map((a) => ({ kind: a.kind })) })) });
    } catch (e) {
      patch({ loading: false });
      this.showToast("Couldn't open this chat. Try again.");
    }
  }

  send(raw) {
    const text = (raw != null ? raw : this.state.draft).trim();
    const files = this.state.pending;
    if ((!text && !files.length) || this.state.typing || this.state.reading) return;
    if (text.length > MAX_MESSAGE_CHARS) return this.showToast(MESSAGE_TOO_LONG);
    const id = this.nextId++;
    let convId = this.state.view === 'chat' ? this.state.activeId : null;
    const current = this.state.convs.find((c) => c.id === convId);
    // Never send from a half-loaded chat: saving it would drop its earlier messages.
    if (current && !current.loaded) return;
    // A chat holds up to 100 of your messages; the draft stays in the box.
    if (current && this.liveMessages(current).length + 1 > MAX_CHAT_MESSAGES) return this.showToast(CHAT_FULL);
    let fresh = null;
    if (!convId) {
      convId = crypto.randomUUID();
      const title = maskCards(text);
      fresh = { id: convId, updatedAt: new Date().toISOString(), title: title ? (title.length > 40 ? title.slice(0, 40).trim() + '...' : title) : 'Attachment', group: 'Today', messages: [], loaded: true, temporary: this.state.temporary };
    }
    this.setState((s) => {
      // The active chat moves to the top of Today.
      const base = fresh ? [fresh, ...s.convs] : [{ ...current, group: 'Today', updatedAt: new Date().toISOString() }, ...s.convs.filter((c) => c.id !== convId)];
      return {
        draft: '',
        pending: [],
        view: 'chat',
        activeId: convId,
        modelMenu: false,
        convs: base.map((c) => c.id === convId ? { ...c, messages: [...c.messages, { id, role: 'user', text, attachments: files }] } : c)
      };
    });
    this.ask(convId);
  }

  stop() {
    if (this.abort) { this.abort.abort(); this.abort = null; }
    this.setState({ typing: false, typingConv: null, replyStarted: false });
  }

  truncateAt(msgId) {
    this.setState((s) => ({
      convs: s.convs.map((c) => {
        if (c.id !== s.activeId) return c;
        const i = c.messages.findIndex((m) => m.id === msgId);
        return i < 0 ? c : { ...c, messages: c.messages.slice(0, i) };
      })
    }));
  }

  edit(msg) {
    this.stop();
    this.truncateAt(msg.id);
    this.setState({ draft: msg.text, pending: (msg.attachments || []).filter((a) => a.data) });
    this.focusComposer();
  }

  async shareChat(id) {
    try {
      const res = await fetch('/api/share', { method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!res.ok) throw new Error(res.status);
      const { shareId } = await res.json();
      this.setState((s) => ({ convs: s.convs.map((c) => (c.id === id ? { ...c, shareId } : c)) }));
      this.copyText(shareUrl(shareId));
      this.showToast('Link copied. Anyone with the link can view this chat.');
    } catch (e) {
      this.showToast("Couldn't share this chat. Try again.");
    }
  }

  async stopSharing(id) {
    this.setState({ shareMenu: false });
    try {
      const res = await fetch('/api/share?id=' + encodeURIComponent(id), { method: 'DELETE', headers: await authHeaders() });
      if (!res.ok) throw new Error(res.status);
      this.setState((s) => ({ convs: s.convs.map((c) => (c.id === id ? { ...c, shareId: null } : c)) }));
      this.showToast('Stopped sharing. The link no longer works.');
    } catch (e) {
      this.showToast("Couldn't stop sharing. Try again.");
    }
  }

  copyText(text) {
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } catch (e) {}
  }

  regen(msg) {
    if (this.state.typing) return;
    this.truncateAt(msg.id);
    this.ask(this.state.activeId);
  }

  copy(key, text) {
    this.copyText(text);
    this.setState({ copied: key });
    this.later(() => this.setState((s) => (s.copied === key ? { copied: null } : null)), 1500);
  }

  vote(m, dir) {
    const next = this.state.votes[m.id] === dir ? null : dir;
    this.setState((s) => ({ votes: { ...s.votes, [m.id]: next } }));
    if (m.traceId) {
      authHeaders().then((headers) => fetch('/api/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({ traceId: m.traceId, value: next === 'up' ? 1 : next === 'down' ? 0 : null })
      })).catch(() => {});
    }
  }

  // ---- Settings: custom instructions and "Delete chats after" (7, 30 or 90 days) ----
  async loadSettings() {
    this.loadMemories();
    try {
      const res = await fetch('/api/settings', { headers: await authHeaders() });
      if (!res.ok) throw new Error('settings ' + res.status);
      const data = await res.json();
      this.setState({
        settings: { chatRetentionDays: data.chatRetentionDays, options: data.retentionOptions, customInstructions: data.customInstructions || '', instructionsMax: data.customInstructionsMax || 1500 },
        instructionsDraft: data.customInstructions || ''
      });
    } catch {
      this.showToast("Couldn't load your settings. Please try again.");
    }
  }

  // ---- Privacy: what Proxi removed from the user's messages, this month and all time ----
  async loadPrivacy() {
    try {
      const res = await fetch('/api/privacy', { headers: await authHeaders() });
      if (!res.ok) throw new Error('privacy ' + res.status);
      this.setState({ privacy: await res.json() });
    } catch {
      this.setState({ privacy: 'error' });
      this.showToast("Couldn't load your privacy summary. Please try again.");
    }
  }

  // ---- Account: delete everything stored for this user, then sign out ----
  askDeleteAccount() {
    this.returnFocus = document.activeElement;
    this.setState({ deleteAccountOpen: true });
    this.later(() => { if (this.cancelDeleteEl) this.cancelDeleteEl.focus(); }, 0);
  }

  closeDeleteAccount() {
    if (this.state.deletingAccount) return;
    this.setState({ deleteAccountOpen: false });
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back && back.focus) this.later(() => back.focus(), 0);
  }

  async deleteAccount() {
    if (this.state.deletingAccount) return;
    this.setState({ deletingAccount: true });
    try {
      const res = await fetch('/api/account', { method: 'DELETE', headers: await authHeaders() });
      if (!res.ok) throw new Error('account ' + res.status);
    } catch {
      this.setState({ deletingAccount: false });
      this.showToast("Couldn't delete your account. Please try again.");
      return;
    }
    try { await window.Clerk.signOut({ redirectUrl: location.origin + '/' }); } catch { location.href = '/'; }
  }

  // ---- Memory: facts Proxi saved to remember. Shown in Settings, where each one can be deleted ----
  async loadMemories() {
    try {
      const res = await fetch('/api/memories', { headers: await authHeaders() });
      if (!res.ok) throw new Error('memories ' + res.status);
      this.setState({ memories: (await res.json()).memories || [] });
    } catch {
      this.setState({ memories: [] });
      this.showToast("Couldn't load your memories. Please try again.");
    }
  }

  async deleteMemory(id) {
    const before = this.state.memories || [];
    this.setState({ memories: before.filter((m) => m.id !== id) });
    try {
      const res = await fetch('/api/memories?id=' + encodeURIComponent(id), { method: 'DELETE', headers: await authHeaders() });
      if (!res.ok) throw new Error('memories ' + res.status);
      this.showToast('Memory deleted');
    } catch {
      this.setState({ memories: before });
      this.showToast("Couldn't delete the memory. Please try again.");
    }
  }

  async saveRetention(days) {
    const before = this.state.settings;
    if (!before || before.chatRetentionDays === days) return;
    this.setState({ settings: { ...before, chatRetentionDays: days }, settingsBusy: true });
    try {
      const res = await fetch('/api/settings', { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ chatRetentionDays: days }) });
      if (!res.ok) throw new Error('settings ' + res.status);
      this.showToast(`Chats will be deleted after ${days} days without activity.`);
    } catch {
      this.setState({ settings: before });
      this.showToast("Couldn't save your settings. Please try again.");
    }
    this.setState({ settingsBusy: false });
  }

  async saveInstructions() {
    const before = this.state.settings;
    const text = this.state.instructionsDraft.trim();
    if (!before || text === before.customInstructions) return;
    this.setState({ settingsBusy: true });
    try {
      const res = await fetch('/api/settings', { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ customInstructions: text }) });
      if (!res.ok) throw new Error('settings ' + res.status);
      this.setState({ settings: { ...before, customInstructions: text }, instructionsDraft: text });
      this.showToast('Instructions saved');
    } catch {
      this.showToast("Couldn't save your instructions. Please try again.");
    }
    this.setState({ settingsBusy: false });
  }

  go(patch) {
    this.setState({ chatMenu: false, shareMenu: false, modelMenu: false, userMenu: false, narrowNav: false, ...patch });
  }

  renderVals() {
    const s = this.state;
    const accent = this.props.accent ?? '#6D28FF';
    const conv = s.convs.find((c) => c.id === s.activeId);
    const isChat = s.view === 'chat' && !!conv;
    const isNew = s.view === 'new' || (s.view === 'chat' && !conv);

    const q = s.query.trim().toLowerCase();
    const item = (c) => {
      const on = isChat && c.id === s.activeId;
      return {
        title: c.title,
        cls: on ? '' : 'hov',
        current: on ? 'page' : 'false',
        bg: on ? 'var(--sunken)' : 'transparent',
        shadow: 'none',
        color: on ? 'var(--text)' : 'var(--text-2)',
        weight: on ? '500' : '400',
        open: () => this.openConversation(c.id)
      };
    };
    // Incognito (temporary) chats are never listed: they exist only until the page reloads.
    const list = s.convs.filter((c) => !c.temporary);
    const searchList = s.searchOpen ? this.searchMatches() : [];
    const recents = list.slice(0, RECENTS_SHOWN).map(item);

    const nav = {};
    ['new', 'privacy'].forEach((k) => {
      const on = k === 'new' ? isNew : s.view === 'privacy';
      nav[k + 'Cls'] = on ? '' : 'hov';
      nav[k + 'Cur'] = on ? 'page' : 'false';
      nav[k + 'Bg'] = on ? 'var(--sunken)' : 'transparent';
      nav[k + 'Shadow'] = 'none';
    });

    const msgs = isChat ? conv.messages.map((m) => {
      const v = s.votes[m.id];
      const key = 'm' + m.id;
      const copied = s.copied === key;
      const shown = m.role === 'user' ? maskCards(m.text || '') : m.text || '';
      return {
        text: shown,
        attachments: (m.attachments || []).map((a, i) => ({
          key: i, thumb: a.data ? a.thumb : '', muted: !a.data,
          label: a.data ? a.name : KIND_LABELS[a.kind] + ' removed'
        })),
        isUser: m.role === 'user',
        isAssistant: m.role === 'assistant',
        hasSteps: !!(m.steps && m.steps.length),
        steps: [...new Set((m.steps || []).map((st) => st.short))].join(' · '),
        stepList: [...(m.steps || []), ...(m.model ? [{ text: 'Answered with ' + modelLabel(m.model), icon: 'spark' }] : [])].map((st, i) => ({ key: i, text: st.text, icon: stepIcon(st.icon) })),
        canVote: !conv.temporary,
        html: m.role === 'assistant' ? renderCitations(renderMarkdown(m.text || '')) : '',
        copied,
        notCopied: !copied,
        copyLabel: copied ? 'Copied' : (m.role === 'user' ? 'Copy message' : 'Copy response'),
        upPressed: v === 'up' ? 'true' : 'false',
        downPressed: v === 'down' ? 'true' : 'false',
        upColor: v === 'up' ? accent : 'var(--text-muted-3)',
        downColor: v === 'down' ? accent : 'var(--text-muted-3)',
        upFill: v === 'up' ? 'currentColor' : 'none',
        downFill: v === 'down' ? 'currentColor' : 'none',
        onCopy: () => this.copy(key, shown),
        onEdit: () => this.edit(m),
        onUp: () => this.vote(m, 'up'),
        onDown: () => this.vote(m, 'down'),
        onRegen: () => this.regen(m),
        isErrorCard: !!m.card,
        cardTitle: m.card ? m.card.title : '',
        cardBody: m.card ? m.card.body : '',
        cardRef: m.card ? m.card.ref : '',
        // Try again replaces the failed reply, the same as Regenerate.
        onRetry: () => this.regen(m)
      };
    }) : [];

    const models = [
      { name: 'Auto', note: 'Balances quality with speed' },
      { name: 'Opus 5.5', note: 'Most capable, for complex work' },
      { name: 'Sonnet 5.5', note: 'Fast and smart for everyday tasks' },
      { name: 'Haiku 5.5', note: 'Fastest, for quick answers' }
    ].map((o) => ({ ...o, on: o.name === s.model, checked: o.name === s.model ? 'true' : 'false', pick: () => this.setState({ model: o.name, modelMenu: false }) }));

    // Starters: they fill the message box (and open the file picker for a PDF) instead of sending.
    const chips = [
      { label: 'Summarize a PDF', draft: 'Summarize the key points of the attached PDF.', files: true },
      { label: 'Draft an email', draft: 'Draft a short, friendly email to ' },
      { label: 'Explain a concept', draft: 'Explain in plain terms: ' }
    ].map((c) => ({ ...c, pick: () => {
      this.setState({ draft: c.draft });
      if (c.files && this.fileEl) this.fileEl.click(); else this.focusComposer();
    } }));

    const canSend = (!!s.draft.trim() || s.pending.length > 0) && !s.reading;
    const tall = s.composerTall || s.pending.length > 0;
    const liveStep = [...s.activity].reverse().find((a) => a.label);
    const showNav = true;

    return {
      accent,
      anyMenu: s.modelMenu || s.chatMenu || s.shareMenu || s.userMenu,
      closeMenus: () => this.setState({ modelMenu: false, chatMenu: false, shareMenu: false, userMenu: false }),
      showNav,
      navClass: s.narrowNav ? 'side open' : (s.collapsed ? 'side collapsed' : 'side'),
      narrowNav: s.narrowNav,
      menuBtnDisplay: s.collapsed ? 'flex' : 'none',
      collapse: () => (this.isNarrow() ? this.setState({ narrowNav: false }) : this.setState({ collapsed: true })),
      openNav: () => (this.isNarrow() ? this.setState({ narrowNav: true, collapsed: false }) : this.setState({ collapsed: false })),
      nav,
      newChat: () => { this.go({ view: 'new', activeId: null, draft: '' }); this.focusComposer(); },
      openSettings: () => { this.go({ view: 'settings' }); this.loadSettings(); },
      openPrivacy: () => { this.go({ view: 'privacy', privacy: null }); this.loadPrivacy(); },
      isPrivacy: s.view === 'privacy',
      privacyLoading: s.view === 'privacy' && !s.privacy,
      privacyError: s.privacy === 'error',
      privacyReady: !!s.privacy && s.privacy !== 'error',
      privacyEmpty: !!s.privacy && s.privacy !== 'error' && s.privacy.all.total === 0,
      privacyHasData: !!s.privacy && s.privacy !== 'error' && s.privacy.all.total > 0,
      privacy: s.privacy && s.privacy !== 'error' ? privacyView(s.privacy, s.privacyPeriod) : null,
      privacyRetry: () => { this.setState({ privacy: null }); this.loadPrivacy(); },
      privacyTabs: [['month', 'This month'], ['all', 'All time']].map(([id, label]) => ({
        key: id, label, pressed: s.privacyPeriod === id ? 'true' : 'false',
        bg: s.privacyPeriod === id ? 'var(--surface)' : 'transparent',
        color: s.privacyPeriod === id ? 'var(--text)' : 'var(--text-muted-2)',
        weight: s.privacyPeriod === id ? 600 : 500,
        shadow: s.privacyPeriod === id ? '0 1px 2px rgba(24,24,27,0.08)' : 'none',
        pick: () => this.setState({ privacyPeriod: id })
      })),
      privacyDocs: DOCS_URL + '/privacy',
      isSettings: s.view === 'settings',
      settingsBusy: !s.settings || s.settingsBusy,
      retentionValue: String(s.settings?.chatRetentionDays ?? 30),
      memoryItems: (s.memories || []).map((m) => ({ key: m.id, text: m.content, remove: () => this.deleteMemory(m.id) })),
      noMemories: Array.isArray(s.memories) && s.memories.length === 0,
      retentionChoices: (s.settings?.options || [7, 30, 90]).map((d) => ({ value: String(d), label: d + ' days' })),
      changeRetention: (e) => this.saveRetention(Number(e.target.value)),
      instructionsMax: s.settings?.instructionsMax || 1500,
      instructionsDraft: s.instructionsDraft,
      instructionsCount: `${s.instructionsDraft.length.toLocaleString('en-US')} / ${(s.settings?.instructionsMax || 1500).toLocaleString('en-US')}`,
      onInstructions: (e) => this.setState({ instructionsDraft: e.target.value }),
      noSaveInstructions: !s.settings || s.settingsBusy || s.instructionsDraft.trim() === s.settings.customInstructions,
      saveInstructionsBg: !s.settings || s.settingsBusy || s.instructionsDraft.trim() === s.settings.customInstructions ? 'var(--disabled)' : 'var(--inverse)',
      saveInstructionsColor: !s.settings || s.settingsBusy || s.instructionsDraft.trim() === s.settings.customInstructions ? 'var(--text-disabled)' : 'var(--on-inverse)',
      saveInstructions: () => this.saveInstructions(),
      themeValue: s.theme,
      themeChoices: [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      changeTheme: (e) => { window.proxiTheme?.set(e.target.value); this.setState({ theme: e.target.value }); },
      searchOpen: s.searchOpen,
      openSearch: () => this.openSearch(),
      closeSearch: () => this.closeSearch(),
      searchBackdrop: (e) => { if (e.target === e.currentTarget) this.closeSearch(); },
      searchRef: (el) => { this.searchEl = el; if (el && this.searchNeedsFocus) { this.searchNeedsFocus = false; el.focus(); } },
      navScroll: (e) => { e.currentTarget.previousElementSibling?.classList.toggle('scrolled', e.currentTarget.scrollTop > 0); },
      searchShortcut: /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K',
      query: s.query,
      onQuery: (e) => this.setState({ query: e.target.value, searchSel: 0 }),
      onSearchKey: (e) => this.onSearchKey(e),
      searchLabel: q ? (searchList.length === 1 ? '1 CHAT' : `${searchList.length} CHATS`) : '',
      searchEmpty: !searchList.length ? (q ? `No chats match "${s.query.trim()}".` : 'No saved chats yet.') : '',
      searchResults: searchList.map((c, i) => ({
        key: c.id,
        parts: highlight(c.title, q),
        when: fullDate(c.updatedAt),
        group: !q && groupOf(c.updatedAt) !== (i ? groupOf(searchList[i - 1].updatedAt) : null) ? groupOf(c.updatedAt) : '',
        selected: i === Math.min(s.searchSel, searchList.length - 1) ? 'true' : 'false',
        open: () => this.pickSearchResult(c.id),
        hover: () => { if (s.searchSel !== i) this.setState({ searchSel: i }); }
      })),
      recents,
      hasMore: list.length > RECENTS_SHOWN,
      historyNote: q ? '' : s.history === 'loading' && !list.length ? 'Loading your chats...'
        : s.history === 'off' ? "Chat history isn't set up yet, so chats aren't saved."
        : s.history === 'error' ? "Couldn't load your previous chats" + (s.historyRef ? ' (error ' + s.historyRef + ').' : '.') : '',
      historyRetry: s.history === 'error' ? () => this.loadConversations() : null,

      isChat, isNew,
      headerBorder: isNew ? 'var(--surface)' : 'var(--divider)',
      chatTitle: conv ? (conv.temporary ? 'Incognito chat' : conv.title) : '',
      temporary: s.temporary,
      temporaryPressed: s.temporary ? 'true' : 'false',
      notTemporary: !s.temporary,
      temporaryBg: s.temporary ? 'var(--inverse)' : 'var(--surface)',
      temporaryBorder: s.temporary ? 'var(--inverse)' : 'var(--border)',
      temporaryColor: s.temporary ? 'var(--on-inverse)' : 'var(--text-muted)',
      temporaryHint: s.temporary ? 'Incognito chat is on. Click to turn it off.' : 'Start an incognito chat',
      composerBorder: (isNew && s.temporary) || (isChat && conv.temporary) ? 'var(--temp-border)' : 'var(--border-strong)',
      composerBorderStyle: (isNew && s.temporary) || (isChat && conv.temporary) ? 'dashed' : 'solid',
      toggleTemporary: () => this.setState({ temporary: !s.temporary }),
      chatMenu: s.chatMenu,
      chatMenuExpanded: s.chatMenu ? 'true' : 'false',
      toggleChatMenu: () => this.setState({ chatMenu: !s.chatMenu, shareMenu: false, modelMenu: false, userMenu: false }),
      deleteAccountOpen: s.deleteAccountOpen,
      deletingAccount: s.deletingAccount,
      deleteAccountLabel: s.deletingAccount ? 'Deleting...' : 'Delete account',
      askDeleteAccount: () => this.askDeleteAccount(),
      cancelDeleteAccount: () => this.closeDeleteAccount(),
      confirmDeleteAccount: () => this.deleteAccount(),
      deleteAccountBackdrop: (e) => { if (e.target === e.currentTarget) this.closeDeleteAccount(); },
      deleteAccountKey: (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closeDeleteAccount(); } },
      cancelDeleteRef: (el) => { this.cancelDeleteEl = el; },
      deleteChat: async () => {
        const id = s.activeId;
        this.stop();
        this.setState((st) => ({ convs: st.convs.filter((c) => c.id !== id), activeId: null, view: 'new', chatMenu: false }));
        try {
          const res = await fetch('/api/conversations?id=' + encodeURIComponent(id), { method: 'DELETE', headers: await authHeaders() });
          this.showToast(res.ok || res.status === 503 ? 'Chat deleted' : "Couldn't delete the chat");
        } catch (e) {
          this.showToast("Couldn't delete the chat");
        }
      },
      canShare: isChat && !conv?.temporary,
      isShared: !!conv?.shareId,
      notShared: !conv?.shareId,
      shareBg: conv?.shareId ? 'var(--accent-soft)' : 'var(--surface)',
      shareBorder: conv?.shareId ? 'var(--accent-line)' : 'var(--border)',
      shareColor: conv?.shareId ? 'var(--link)' : 'var(--text)',
      shareHasPopup: conv?.shareId ? 'menu' : null,
      shareMenu: s.shareMenu,
      shareMenuExpanded: conv?.shareId ? (s.shareMenu ? 'true' : 'false') : null,
      share: () => (conv?.shareId ? this.setState({ shareMenu: !s.shareMenu, chatMenu: false, modelMenu: false, userMenu: false }) : this.shareChat(s.activeId)),
      copyShareLink: () => { this.copyText(shareUrl(conv.shareId)); this.setState({ shareMenu: false }); this.showToast('Link copied'); },
      stopSharing: () => this.stopSharing(s.activeId),

      msgRef: (el) => {
        if (el === this.msgEl) return;
        this.msgEl = el;
        // When the list's height changes (keyboard, attachments, rotation), stay at the bottom if we were there.
        if (this.msgObserver) this.msgObserver.disconnect();
        if (el && window.ResizeObserver) {
          this.msgObserver = new ResizeObserver(() => { if (this.atBottom) el.scrollTop = el.scrollHeight; });
          this.msgObserver.observe(el);
        }
      },
      onMsgScroll: () => this.onMsgScroll(),
      msgs,
      workingLabel: conv && conv.loading ? 'Loading' : liveStep ? liveStep.label : WORKING_VERBS[s.verbTick % WORKING_VERBS.length],
      showTyping: isChat && ((s.typing && !s.replyStarted && s.typingConv === s.activeId) || !!conv.loading),

      showComposer: isChat || isNew,
      composerPad: '8px 24px 20px',
      composerMax: isNew ? '720px' : '760px',
      composerRadius: tall ? '22px' : '28px',
      composerPadding: tall ? '10px 8px 6px 8px' : '6px 6px 6px 6px',
      attachOrder: tall ? 2 : 1,
      textOrder: tall ? 1 : 2,
      textFlex: tall ? '1 0 100%' : '1 1 0',
      textPadding: tall ? '6px 10px 4px' : '10px 6px',
      modelName: s.model.split(' ')[0],
      modelVersion: s.model.split(' ').slice(1).join(' '),
      showChips: isNew && !s.draft.trim() && !s.pending.length,
      taRef: (el) => { this.taEl = el; },
      draft: s.draft,
      maxChars: MAX_MESSAGE_CHARS,
      onDraft: (e) => {
        // The box stops at the limit, and pasting more is cut there: say so when it is reached.
        if (e.target.value.length >= MAX_MESSAGE_CHARS) this.showToast(MESSAGE_TOO_LONG);
        this.setState({ draft: e.target.value });
      },
      onKey: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) { e.preventDefault(); this.send(); }
      },
      onSubmit: (e) => { e.preventDefault(); this.send(); },
      accept: ACCEPT,
      fileRef: (el) => { this.fileEl = el; },
      attach: () => { if (this.fileEl) this.fileEl.click(); },
      onFiles: (e) => { const files = Array.from(e.target.files); e.target.value = ''; this.addFiles(files); },
      pending: s.pending.map((a) => ({ id: a.id, name: a.name, thumb: a.thumb, size: formatSize(a.bytes), remove: () => this.setState((st) => ({ pending: st.pending.filter((x) => x.id !== a.id) })) })),
      imageHint: s.pending.some((a) => a.kind === 'image'),
      dragging: s.dragging,
      onPaste: (e) => {
        const files = e.clipboardData && e.clipboardData.files;
        if (files && files.length) { e.preventDefault(); this.addFiles(files); }
      },
      onDragOver: (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        if (!s.dragging && (isChat || isNew)) this.setState({ dragging: true });
      },
      onDragLeave: (e) => {
        if (s.dragging && !e.currentTarget.contains(e.relatedTarget)) this.setState({ dragging: false });
      },
      onDrop: (e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        this.setState({ dragging: false });
        if (isChat || isNew) this.addFiles(e.dataTransfer.files);
      },
      model: s.model,
      models,
      modelMenu: s.modelMenu,
      modelMenuExpanded: s.modelMenu ? 'true' : 'false',
      toggleModelMenu: () => this.setState({ modelMenu: !s.modelMenu, chatMenu: false, shareMenu: false, userMenu: false }),
      typing: s.typing,
      notTyping: !s.typing,
      stop: () => this.stop(),
      noSend: !canSend,
      sendBg: canSend ? 'var(--inverse)' : 'var(--disabled)',
      sendColor: canSend ? 'var(--on-inverse)' : 'var(--text-disabled)',
      sendCursor: canSend ? 'pointer' : 'default',
      chips,

      userName: this.props.userName,
      userImage: this.props.userImage,
      userInitial: (this.props.userName || '?').trim().charAt(0).toUpperCase(),
      userMenu: s.userMenu,
      userMenuExpanded: s.userMenu ? 'true' : 'false',
      toggleUserMenu: () => this.setState({ userMenu: !s.userMenu, chatMenu: false, shareMenu: false, modelMenu: false }),
      docsHome: DOCS_URL,
      docsIncognito: DOCS_URL + '/privacy#incognito-chats',
      privacyPolicy: DOCS_URL + '/privacy-policy',
      terms: DOCS_URL + '/terms',
      closeUserMenu: () => this.setState({ userMenu: false }),
      logout: async () => {
        this.setState({ userMenu: false });
        try {
          await window.Clerk.signOut({ redirectUrl: location.origin + '/' });
        } catch (e) {
          this.showToast("Couldn't log out. Please try again.");
        }
      },

      hasToast: !!s.toast,
      toast: s.toast
    };
  }
}

const propDefs = {"accent":{"editor":"color","default":"#6D28FF","options":["#6D28FF","#0F7B5F","#F4511E","#111111"]},"startView":{"editor":"enum","options":["chat","new"],"default":"chat"},"$preview":{"width":1440,"height":900}};
const props = {};
for (const [k, d] of Object.entries(propDefs)) if (!k.startsWith('$')) props[k] = d.default;

// Clerk's test mode keeps its browser token in two cookies: one per Clerk app and a
// shared copy, and falls back to the shared copy when the app's own is missing. After
// switching Clerk apps, that shared copy belongs to the old app and every sign-in fails
// with "authorization_invalid". Dropping it leaves the per-app cookie in charge; if that
// is missing too, Clerk creates a fresh token.
function clearSharedClerkToken() {
  for (const extra of ['', '; Secure; SameSite=None', '; Secure; SameSite=None; Partitioned']) {
    document.cookie = '__clerk_db_jwt=; Max-Age=0; Path=/' + extra;
  }
}

// A shared chat (/s/<id>) is public: rendered without signing in and read-only.
async function startShared(shareId) {
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
    const res = await fetch('/api/shared?id=' + encodeURIComponent(shareId));
    if (res.ok) chat = await res.json();
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

async function start() {
  const shared = location.pathname.match(/^\/s\/([\w-]{22})\/?$/);
  if (shared) return startShared(shared[1]);
  const clerk = window.Clerk;
  clearSharedClerkToken();
  await clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    appearance: { variables: { colorPrimary: '#6D28FF', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '10px' } }
  });
  // Signing in swaps the sign-in screen for the chat. Signing out is handled by
  // logout(), which must let Clerk finish ending the session before reloading.
  const signedIn = !!clerk.user;
  clerk.addListener(({ user }) => { if (user && !signedIn) location.reload(); });
  if (!signedIn) {
    // Sign-in happens on Clerk's hosted page (it handles sign-up, Google and GitHub, and
    // Clerk's fraud checks under its own security policy), then returns here signed in.
    const back = location.origin + '/';
    const goToSignIn = () => clerk.redirectToSignIn({ signInForceRedirectUrl: back, signUpForceRedirectUrl: back });
    let redirected = true;
    try { redirected = sessionStorage.getItem('proxi-sign-in') === '1'; sessionStorage.setItem('proxi-sign-in', '1'); } catch {}
    if (!redirected) return goToSignIn();
    // Already sent there once in this tab and still signed out: show the button instead of looping.
    document.getElementById('auth').hidden = false;
    document.getElementById('sign-in').addEventListener('click', goToSignIn);
    return;
  }
  try { sessionStorage.removeItem('proxi-sign-in'); } catch {}
  document.documentElement.classList.add('app-mode');
  trackViewport();
  props.userName = clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || 'Signed in';
  props.userImage = clerk.user.hasImage ? clerk.user.imageUrl : '';
  createApp({
    template: '#tpl',
    setup() {
      const tick = ref(0);
      const comp = new Component(props);
      comp.tick = tick;
      const v = computed(() => (tick.value, comp.renderVals()));
      onMounted(() => comp.componentDidMount && comp.componentDidMount());
      onUpdated(() => comp.componentDidUpdate && comp.componentDidUpdate());
      onBeforeUnmount(() => comp.componentWillUnmount && comp.componentWillUnmount());
      return { v };
    }
  }).mount('#app');
}
start();
