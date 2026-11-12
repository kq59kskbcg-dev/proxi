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

test('Settings opens on General, and unchecking a tool turns it off', async () => {
  const state = { ...settingsState, memories: [], view: 'new', settings: { chatRetentionDays: 30, options: [7, 30, 90], customInstructions: '', instructionsMax: 1500, disabledTools: [], toolOptions: ['web_search', 'save_memory'] } };
  const view = () => createSettings(fakeApp(state)).views.settings();
  assert.equal(view().onGeneralTab, true);
  assert.deepEqual(view().toolItems.map((t) => [t.id, t.on]), [['web_search', true], ['save_memory', true]]);
  const sent = [];
  window.Clerk = { session: { getToken: async () => 'token' } };
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  await view().toolItems[0].change({ target: { checked: false } });
  assert.deepEqual(state.settings.disabledTools, ['web_search']);
  assert.deepEqual(sent.at(-1), { disabledTools: ['web_search'] });
  assert.equal(view().toolItems[0].on, false);
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
  assert.equal(view().recentsEmpty, false);
  state.history = 'ok';
  assert.equal(view().historyLoading, false);
  assert.equal(view().recentsEmpty, true);
  state.query = 'x';
  assert.equal(view().recentsEmpty, false);
  state.query = '';
  state.convs = [{ id: 'a', title: 'Hi', updatedAt: 1 }];
  assert.equal(view().recentsEmpty, false);
});

test('opening a saved chat shows the loading spinner, not the reply indicator', async () => {
  // The page loads these as scripts before the modules.
  globalThis.DOMPurify ??= { addHook() {}, sanitize: (h) => h };
  globalThis.Vue ??= { shallowReactive: (o) => o, computed: (f) => ({ get value() { return f(); } }) };
  const { createChat, chatState } = await import('../ui/chat.js');
  const conv = { id: 'c1', messages: [], loading: true };
  const state = { ...chatState, convs: [conv], activeId: 'c1', view: 'chat', activity: [] };
  const app = { ...fakeApp(state), isChat: { value: true }, activeConv: { value: conv } };
  const view = () => createChat(app).views.typingIndicator();
  assert.equal(view().chatLoading, true);
  assert.equal(view().showTyping, false);
  conv.loading = false;
  assert.equal(view().chatLoading, false);
});
