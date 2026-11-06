// Settings: tabs for General (theme, custom instructions, account), Memory, Shared links, Tools
// (turn each tool off or on) and History ("Delete chats after", 7, 30 or 90 days, and "Delete all
// chats"). Settings opens on its own screen on the General tab, without the sidebar; the X (or Esc)
// goes back to where you were. Memory, Shared links and Account are in memories.js, share.js and
// account.js.

import { api } from './api.js';

export const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'memory', label: 'Memory' },
  { id: 'links', label: 'Shared links' },
  { id: 'tools', label: 'Tools' },
  { id: 'history', label: 'History' }
];

// The tools in the Tools tab, by the name the server uses. Icons are 24x24 stroke paths.
export const TOOLS = [
  { id: 'web_search', label: 'Search the web', hint: 'For current information.', icon: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>' },
  { id: 'search_docs', label: 'Search help center', hint: 'Answers about Proxi from the help center.', icon: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"></path><path d="M4 19V5"></path>' },
  { id: 'search_chats', label: 'Search your chats', hint: 'Look up things you talked about before.', icon: '<path d="M21 12a8 8 0 0 1-12 7l-5 1 1-4a8 8 0 1 1 16-4z"></path>' },
  { id: 'save_memory', label: 'Save to memory', hint: 'Suggest things to remember. You approve each one.', icon: '<path d="M12 3a6 6 0 0 0-6 6c0 2 1 3 2 4v3h8v-3c1-1 2-2 2-4a6 6 0 0 0-6-6z"></path><path d="M9 20h6"></path>' },
  { id: 'offer_message_to_lisandro', label: 'Talk to a person', hint: 'Offer to send us a message for you.', icon: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path>' },
  { id: 'get_status', label: 'Check service status', hint: "See whether Proxi's tools are running.", icon: '<path d="M3 12h4l3-8 4 16 3-8h4"></path>' }
];

const THEMES = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];

export const settingsState = {
  settings: null, // null until loaded
  settingsBusy: false,
  settingsFailed: false, // true when loading the settings failed
  instructionsDraft: '',
  settingsReturn: 'new', // the screen the close button goes back to
  settingsTab: 'general',
  theme: window.proxiTheme?.get() || 'system',
  deleteChatsOpen: false,
  deletingChats: false
};

export function createSettings(app) {
  const s = app.state;
  let cancelDeleteChatsEl = null;

  async function loadSettings() {
    app.setState({ settingsFailed: false });
    app.loadMemories();
    app.loadSharedLinks();
    try {
      const data = await api.get('/api/settings');
      app.setState({
        settings: { chatRetentionDays: data.chatRetentionDays, options: data.retentionOptions, customInstructions: data.customInstructions || '', instructionsMax: data.customInstructionsMax || 1500, disabledTools: data.disabledTools || [], toolOptions: data.toolOptions || TOOLS.map((t) => t.id) },
        instructionsDraft: data.customInstructions || ''
      });
    } catch {
      app.setState({ settingsFailed: true });
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
      app.loadSharedLinks(); // links expire with their chat, so their dates change too
    } catch {
      app.setState({ settings: before });
      app.showToast("Couldn't save your settings. Please try again.");
    }
    app.setState({ settingsBusy: false });
  }

  // Checking or unchecking a tool saves at once. If saving fails, the box goes back.
  async function toggleTool(id, on) {
    const before = s.settings;
    if (!before) return;
    const current = before.disabledTools || [];
    const disabledTools = on ? current.filter((t) => t !== id) : [...new Set([...current, id])];
    app.setState({ settings: { ...before, disabledTools } });
    try {
      await api.put('/api/settings', { disabledTools });
    } catch {
      app.setState({ settings: { ...s.settings, disabledTools: current } });
      app.showToast("Couldn't save your settings. Please try again.");
    }
  }

  // Tabs: Left and Right (or Up and Down in the list on a computer) move between them, Home and End
  // go to the first and last, as in a standard tab list.
  function selectTab(id, focus) {
    app.setState({ settingsTab: id });
    app.later(() => {
      const tab = document.getElementById('settings-tab-' + id);
      if (!tab) return;
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // the phone's tab bar scrolls
      if (focus) tab.focus();
    }, 0);
  }
  function tabKey(e) {
    const i = SETTINGS_TABS.findIndex((t) => t.id === s.settingsTab);
    const last = SETTINGS_TABS.length - 1;
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    selectTab(SETTINGS_TABS[(to + SETTINGS_TABS.length) % SETTINGS_TABS.length].id, true);
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
      sharedLinks: [],
      deletingChats: false,
      deleteChatsOpen: false
    }));
    app.showToast('All chats deleted');
  }

  function openSettings() {
    if (s.view !== 'settings') app.setState({ settingsReturn: s.view, settingsTab: 'general' });
    app.go({ view: 'settings' });
    loadSettings();
  }

  function closeSettings() {
    app.go({ view: s.settingsReturn || 'new' });
  }

  // Esc closes Settings, unless a dialog or menu is open or the key was meant for a field.
  const onKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || s.view !== 'settings') return;
    if (s.searchOpen || s.deleteAccountOpen || s.deleteChatsOpen || s.userMenu) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    closeSettings();
  };

  return {
    mounted() { window.addEventListener('keydown', onKey); },
    unmounted() { window.removeEventListener('keydown', onKey); },

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
          openSettings,
          closeSettings,
          settingsTabs: SETTINGS_TABS.map((t) => ({
            ...t,
            selected: s.settingsTab === t.id,
            tabId: 'settings-tab-' + t.id,
            select: () => selectTab(t.id)
          })),
          settingsTabKey: tabKey,
          settingsTabId: 'settings-tab-' + s.settingsTab,
          settingsTabLabel: (SETTINGS_TABS.find((t) => t.id === s.settingsTab) || SETTINGS_TABS[0]).label,
          onGeneralTab: s.settingsTab === 'general',
          onMemoryTab: s.settingsTab === 'memory',
          onLinksTab: s.settingsTab === 'links',
          onToolsTab: s.settingsTab === 'tools',
          onHistoryTab: s.settingsTab === 'history',
          toolItems: TOOLS.filter((t) => !s.settings?.toolOptions || s.settings.toolOptions.includes(t.id)).map((t) => ({
            ...t,
            on: !(s.settings?.disabledTools || []).includes(t.id),
            inputId: 'tool-' + t.id,
            hintId: 'tool-hint-' + t.id,
            change: (e) => toggleTool(t.id, e.target.checked)
          })),
          // The page shows one spinner until both the settings and the memories have loaded.
          settingsReady: !!s.settings && s.memories !== null,
          settingsLoading: !(s.settings && s.memories !== null) && !(s.settingsFailed && !s.settings),
          settingsError: s.settingsFailed && !s.settings,
          settingsRetry: () => loadSettings(),
          settingsBusy: !s.settings || s.settingsBusy,
          retentionValue: String(s.settings?.chatRetentionDays ?? 30),
          retentionChoices: (s.settings?.options || [7, 30, 90]).map((d) => ({ value: String(d), label: d + ' days' })),
          changeRetention: (e) => saveRetention(Number(e.target.value)),
          instructionsMax: max,
          instructionsDraft: s.instructionsDraft,
          instructionsCount: `${s.instructionsDraft.length.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`,
          onInstructions: (e) => app.setState({ instructionsDraft: e.target.value }),
          noSaveInstructions: unchanged,
          saveInstructions,
          themeValue: s.theme,
          themeChoices: THEMES,
          changeTheme: (e) => { window.proxiTheme?.set(e.target.value); app.setState({ theme: e.target.value }); }
        };
      }
    }
  };
}
