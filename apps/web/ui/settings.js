// Settings: custom instructions, theme and "Delete chats after" (7, 30 or 90 days).
// Settings opens on its own screen, without the sidebar; the X (or Esc) goes back to where you were.
// The Memory and Account sections are in memories.js and account.js.

import { api } from './api.js';

const THEMES = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];

export const settingsState = {
  settings: null, // null until loaded
  settingsBusy: false,
  settingsFailed: false, // true when loading the settings failed
  instructionsDraft: '',
  settingsReturn: 'new', // the screen the close button goes back to
  theme: window.proxiTheme?.get() || 'system'
};

export function createSettings(app) {
  const s = app.state;

  async function loadSettings() {
    app.setState({ settingsFailed: false });
    app.loadMemories();
    try {
      const data = await api.get('/api/settings');
      app.setState({
        settings: { chatRetentionDays: data.chatRetentionDays, options: data.retentionOptions, customInstructions: data.customInstructions || '', instructionsMax: data.customInstructionsMax || 1500 },
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

  function openSettings() {
    if (s.view !== 'settings') app.setState({ settingsReturn: s.view });
    app.go({ view: 'settings' });
    loadSettings();
  }

  function closeSettings() {
    app.go({ view: s.settingsReturn || 'new' });
  }

  // Esc closes Settings, unless a dialog or menu is open or the key was meant for a field.
  const onKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || s.view !== 'settings') return;
    if (s.searchOpen || s.deleteAccountOpen || s.userMenu) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    closeSettings();
  };

  return {
    mounted() { window.addEventListener('keydown', onKey); },
    unmounted() { window.removeEventListener('keydown', onKey); },

    views: {
      settings: () => {
        const max = s.settings?.instructionsMax || 1500;
        const unchanged = !s.settings || s.settingsBusy || s.instructionsDraft.trim() === s.settings.customInstructions;
        return {
          openSettings,
          closeSettings,
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
