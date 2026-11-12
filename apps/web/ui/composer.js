// The message box: the draft, attachments, the model menu, starters and the incognito toggle.

import { MAX_MESSAGE_CHARS, MESSAGE_TOO_LONG } from './limits.js';
import { MAX_FILES, MAX_TOTAL, MAX_TEXT, ACCEPT, classify, formatSize, readBase64, makeThumb } from './files.js';
import { visibleSuggestions } from './reply-suggestions.js';

const MODELS = [
  { name: 'Auto', note: 'Balances quality with speed' },
  { name: 'Opus 5.5', note: 'Most capable, for complex work' },
  { name: 'Sonnet 5.5', note: 'Fast and smart for everyday tasks' },
  { name: 'Haiku 5.5', note: 'Fastest, for quick answers' }
];

// Starters: common questions about Proxi, sent as soon as one is tapped.
const CHIPS = ['What is Proxi?', 'What can Proxi do?', 'How does Proxi protect my privacy?'];

export const composerState = {
  draft: '',
  composerTall: false,
  pending: [], // attachments waiting to be sent
  reading: false, // attachments still being read
  dragging: false,
  model: 'Auto',
  modelMenu: false,
  // The next new chat is incognito. It stays on for new chats until turned off, remembered in this browser.
  temporary: (() => { try { return localStorage.getItem('proxi-incognito') === 'on'; } catch { return false; } })()
};

export function createComposer(app) {
  const s = app.state;
  const els = app.els;

  function focusComposer() {
    setTimeout(() => { if (els.textarea) els.textarea.focus(); }, 0);
  }

  // The message box starts as one line next to its buttons. Once the text wraps
  // it takes the full width (buttons move below) and grows up to 8 lines.
  function sizeComposer() {
    const ta = els.textarea;
    if (!ta) return;
    const line = 24, max = line * 8 + 20;
    if (!s.draft) {
      ta.style.height = '44px';
      ta.style.overflowY = 'hidden';
      if (s.composerTall) app.setState({ composerTall: false });
      return;
    }
    ta.style.height = 'auto';
    const h = ta.scrollHeight;
    ta.style.height = Math.min(Math.max(h, 44), max) + 'px';
    ta.style.overflowY = h > max ? 'auto' : 'hidden';
    const tall = s.draft.includes('\n') || h > 44 + 4;
    if (tall && !s.composerTall) app.setState({ composerTall: true });
  }

  // Why a file can't be added, or '' if it can.
  function fileProblem(file, pending) {
    if (/\.(docx?|xlsx?|pptx?)$/i.test(file.name)) return "Word, Excel and PowerPoint files aren't supported yet. Try a PDF or plain text.";
    const kind = classify(file);
    if (!kind) return file.name + " isn't supported. Attach images, PDFs or plain text files.";
    if (file.size === 0) return file.name + ' is empty.';
    if (pending.length >= MAX_FILES) return 'You can attach up to ' + MAX_FILES + ' files per message.';
    if (kind === 'text' && file.size > MAX_TEXT) return file.name + ' is too large. Text files can be up to 200 KB.';
    if (pending.reduce((sum, a) => sum + a.bytes, 0) + file.size > MAX_TOTAL) return 'Attachments can be up to 3 MB in total.';
    return '';
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    app.setState({ reading: true });
    const pending = s.pending.slice();
    try {
      for (const file of files) {
        const problem = fileProblem(file, pending);
        if (problem) { app.showToast(problem); continue; }
        const kind = classify(file);
        pending.push({
          id: app.nextId(), name: file.name || 'file', kind, bytes: file.size,
          mediaType: kind === 'image' ? file.type : kind === 'pdf' ? 'application/pdf' : 'text/plain',
          data: await readBase64(file), thumb: kind === 'image' ? await makeThumb(file) : ''
        });
      }
    } catch (e) {
      app.showToast("Couldn't read that file. Please try again.");
    }
    app.setState({ pending, reading: false });
    focusComposer();
  }

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const taRef = (el) => { els.textarea = el; };
  const fileRef = (el) => { els.filePicker = el; };

  return {
    actions: { focusComposer },
    updated() { sizeComposer(); },

    views: {
      composer: () => {
        const isChat = app.isChat.value;
        const isNew = app.isNew.value;
        const incognito = (isNew && s.temporary) || (isChat && app.activeIncognito.value);
        const canSend = (!!s.draft.trim() || s.pending.length > 0) && !s.reading;
        const tall = s.composerTall || s.pending.length > 0;
        // With the reply card above it, the box squares its top corners and asks for another answer.
        const underCard = isChat && !!s.suggestions && visibleSuggestions(s.suggestions, app.activeConv.value, { typing: s.typing, draft: s.draft, pending: s.pending }).length > 0;
        const radius = tall ? '22px' : '28px';
        return {
          temporary: s.temporary,
          temporaryPressed: s.temporary ? 'true' : 'false',
          notTemporary: !s.temporary,
          temporaryBg: s.temporary ? 'var(--inverse)' : 'var(--surface)',
          temporaryBorder: s.temporary ? 'var(--inverse)' : 'var(--border)',
          temporaryColor: s.temporary ? 'var(--on-inverse)' : 'var(--text-muted)',
          temporaryHint: s.temporary ? 'Incognito chat is on. Click to turn it off.' : 'Start an incognito chat',
          composerBorder: incognito ? 'var(--temp-border)' : 'var(--border-strong)',
          composerBorderStyle: incognito ? 'dashed' : 'solid',
          toggleTemporary: () => {
            const next = !s.temporary;
            try { if (next) localStorage.setItem('proxi-incognito', 'on'); else localStorage.removeItem('proxi-incognito'); } catch {}
            app.setState({ temporary: next });
          },

          showComposer: isChat || isNew,
          composerPad: '8px 24px 20px',
          composerMax: isNew ? '720px' : '760px',
          composerRadius: underCard ? `0 0 ${radius} ${radius}` : radius,
          placeholder: underCard ? 'Other response' : 'Message Proxi',
          composerPadding: tall ? '10px 8px 6px 8px' : '6px 6px 6px 6px',
          attachOrder: tall ? 2 : 1,
          textOrder: tall ? 1 : 2,
          textFlex: tall ? '1 0 100%' : '1 1 0',
          textPadding: tall ? '6px 10px 4px' : '10px 6px',
          modelName: s.model.split(' ')[0],
          modelVersion: s.model.split(' ').slice(1).join(' '),
          showChips: isNew && !s.draft.trim() && !s.pending.length,
          taRef,
          draft: s.draft,
          maxChars: MAX_MESSAGE_CHARS,
          onDraft: (e) => {
            // The box stops at the limit, and pasting more is cut there: say so when it is reached.
            if (e.target.value.length >= MAX_MESSAGE_CHARS) app.showToast(MESSAGE_TOO_LONG);
            app.setState({ draft: e.target.value });
          },
          onKey: (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) { e.preventDefault(); app.send(); }
          },
          onSubmit: (e) => { e.preventDefault(); app.send(); },
          accept: ACCEPT,
          fileRef,
          attach: () => { if (els.filePicker) els.filePicker.click(); },
          onFiles: (e) => { const files = Array.from(e.target.files); e.target.value = ''; addFiles(files); },
          pending: s.pending.map((a) => ({ id: a.id, name: a.name, thumb: a.thumb, size: formatSize(a.bytes), remove: () => app.setState((st) => ({ pending: st.pending.filter((x) => x.id !== a.id) })) })),
          imageHint: s.pending.some((a) => a.kind === 'image'),
          dragging: s.dragging,
          onPaste: (e) => {
            const files = e.clipboardData && e.clipboardData.files;
            if (files && files.length) { e.preventDefault(); addFiles(files); }
          },
          onDragOver: (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            if (!s.dragging && (isChat || isNew)) app.setState({ dragging: true });
          },
          onDragLeave: (e) => {
            if (s.dragging && !e.currentTarget.contains(e.relatedTarget)) app.setState({ dragging: false });
          },
          onDrop: (e) => {
            if (!hasFiles(e)) return;
            e.preventDefault();
            app.setState({ dragging: false });
            if (isChat || isNew) addFiles(e.dataTransfer.files);
          },
          model: s.model,
          models: MODELS.map((o) => ({ ...o, on: o.name === s.model, checked: o.name === s.model ? 'true' : 'false', pick: () => app.setState({ model: o.name, modelMenu: false }) })),
          modelMenu: s.modelMenu,
          modelMenuExpanded: s.modelMenu ? 'true' : 'false',
          toggleModelMenu: () => app.setState({ modelMenu: !s.modelMenu, chatMenu: false, shareMenu: false, userMenu: false }),
          typing: s.typing,
          notTyping: !s.typing,
          stop: () => app.stop(),
          noSend: !canSend,
          sendBg: 'var(--send)',
          sendColor: 'var(--on-send)',
          sendOpacity: canSend ? 1 : 0.4,
          sendCursor: canSend ? 'pointer' : 'default',
          chips: CHIPS.map((label) => ({ label, pick: () => app.send(label) }))
        };
      }
    }
  };
}
