import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= {};
const { createSettings, settingsState } = await import('../ui/settings.js');
const { createSidebar, sidebarState } = await import('../ui/sidebar.js');

const fakeApp = (state) => ({ state, setState: (p) => Object.assign(state, p), showToast() {}, loadMemories() {} });

test('Settings shows one spinner until both the settings and the memories have loaded', () => {
  const state = { ...settingsState, memories: null };
  const view = () => createSettings(fakeApp(state)).views.settings();
  assert.equal(view().settingsLoading, true);
  assert.equal(view().settingsReady, false);
  state.settings = { chatRetentionDays: 30, options: [7, 30, 90], customInstructions: '', instructionsMax: 1500 };
  assert.equal(view().settingsLoading, true);
  state.memories = [];
  assert.equal(view().settingsLoading, false);
  assert.equal(view().settingsReady, true);
});

test('Settings shows an error with Try again when loading fails', () => {
  const state = { ...settingsState, memories: [], settingsFailed: true };
  const v = createSettings(fakeApp(state)).views.settings();
  assert.equal(v.settingsLoading, false);
  assert.equal(v.settingsError, true);
  assert.equal(v.settingsReady, false);
});

test('the chat list shows its spinner only while the first chats load', () => {
  const state = { ...sidebarState, convs: [], view: 'new', query: '' };
  const app = { ...fakeApp(state), isChat: { value: false }, isNew: { value: true } };
  const view = () => createSidebar(app).views.sidebar();
  assert.equal(view().historyLoading, true);
  assert.equal(view().historyNote, '');
  state.history = 'ok';
  assert.equal(view().historyLoading, false);
});
