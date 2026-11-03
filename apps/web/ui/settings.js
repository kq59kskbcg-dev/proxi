// Settings: custom instructions, theme, "Delete chats after" (7, 30 or 90 days) and
// "Delete all chats".
// The Memory and Account sections are in memories.js and account.js.

import { api } from './api.js';

const THEMES = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];

export const settingsState = {
  settings: null, // null until loaded
  settingsBusy: false,
  instructionsDraft: '',
  theme: window.proxiTheme?.get() || 'system',
  deleteChatsOpen: false,
  deletingChats: false
};

export function createSettings(app) {
  const s = app.state;
  let cancelDeleteChatsEl = null;

  async function loadSettings() {
    app.loadMemories();
    try {
      const data = await api.get('/api/settings');
      app.setState({
        settings: { chatRetentionDays: data.chatRetentionDays, options: data.retentionOptions, customInstructions: data.customInstructions || '', instructionsMax: data.customInstructionsMax || 1500 },
        instructionsDraft: data.customInstructions || ''
      });
    } catch {
      app.showToast("Couldn't load your settings. Please try again.");
    }
  }

  async function saveRetention(days) {
    const before = s.settings;
    if (!before || before.chatRetentionDays === days) return;
    app.setState({ settings: { ...before, chatRetentionDays: days }, settingsBusy: true });
    try {
      await api.put('/api/settings', { chatRetentionDays: days });
      app.showToast(`Chats will be deleted after ${days} days without activity.`);
    } catch {
      app.setState({ settings: before });
      app.showToast("Couldn't save your settings. Please try again.");
    }
    app.setState({ settingsBusy: false });
  }

  async function saveInstructions() {
    const before = s.settings;
    const text = s.instructionsDraft.trim();
    if (!before || text === before.customInstructions) return;
    app.setState({ settingsBusy: true });
    try {
      await api.put('/api/settings', { customInstructions: text });
      app.setState({ settings: { ...before, customInstructions: text }, instructionsDraft: text });
      app.showToast('Instructions saved');
    } catch {
      app.showToast("Couldn't save your instructions. Please try again.");
    }
    app.setState({ settingsBusy: false });
  }

  function askDeleteChats() {
    app.returnFocus = document.activeElement;
    app.setState({ deleteChatsOpen: true });
    app.later(() => { if (cancelDeleteChatsEl) cancelDeleteChatsEl.focus(); }, 0);
  }

  function closeDeleteChats() {
    if (s.deletingChats) return;
    app.setState({ deleteChatsOpen: false });
    const back = app.returnFocus;
    app.returnFocus = null;
    if (back && back.focus) app.later(() => back.focus(), 0);
  }

  // Deletes every saved chat. Incognito chats aren't saved, so they stay until the page reloads.
  async function deleteAllChats() {
    if (s.deletingChats) return;
    app.setState({ deletingChats: true });
    try {
      await api.delete('/api/conversations', { query: { all: '1' } });
    } catch {
      app.setState({ deletingChats: false });
      app.showToast("Couldn't delete your chats. Please try again.");
      return;
    }
    const active = s.convs.find((c) => c.id === s.activeId);
    if (active && !active.temporary) app.stop();
    app.setState((st) => ({
      convs: st.convs.filter((c) => c.temporary),
      activeId: active && !active.temporary ? null : st.activeId,
      deletingChats: false,
      deleteChatsOpen: false
    }));
    app.showToast('All chats deleted');
  }

  return {
    views: {
      deleteChats: () => ({
        hasChats: s.convs.some((c) => !c.temporary),
        askDeleteChats,
        deleteChatsOpen: s.deleteChatsOpen,
        deletingChats: s.deletingChats,
        deleteChatsLabel: s.deletingChats ? 'Deleting...' : 'Delete all chats',
        cancelDeleteChats: closeDeleteChats,
        confirmDeleteChats: deleteAllChats,
        deleteChatsBackdrop: (e) => { if (e.target === e.currentTarget) closeDeleteChats(); },
        deleteChatsKey: (e) => { if (e.key === 'Escape') { e.preventDefault(); closeDeleteChats(); } },
        cancelDeleteChatsRef: (el) => { cancelDeleteChatsEl = el; }
      }),

      settings: () => {
        const max = s.settings?.instructionsMax || 1500;
        const unchanged = !s.settings || s.settingsBusy || s.instructionsDraft.trim() === s.settings.customInstructions;
        return {
          openSettings: () => { app.go({ view: 'settings' }); loadSettings(); },
          settingsBusy: !s.settings || s.settingsBusy,
          retentionValue: String(s.settings?.chatRetentionDays ?? 30),
          retentionChoices: (s.settings?.options || [7, 30, 90]).map((d) => ({ value: String(d), label: d + ' days' })),
          changeRetention: (e) => saveRetention(Number(e.target.value)),
          instructionsMax: max,
          instructionsDraft: s.instructionsDraft,
          instructionsCount: `${s.instructionsDraft.length.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`,
          onInstructions: (e) => app.setState({ instructionsDraft: e.target.value }),
          noSaveInstructions: unchanged,
          saveInstructionsBg: unchanged ? 'var(--disabled)' : 'var(--inverse)',
          saveInstructionsColor: unchanged ? 'var(--text-disabled)' : 'var(--on-inverse)',
          saveInstructions,
          themeValue: s.theme,
          themeChoices: THEMES,
          changeTheme: (e) => { window.proxiTheme?.set(e.target.value); app.setState({ theme: e.target.value }); }
        };
      }
    }
  };
}
