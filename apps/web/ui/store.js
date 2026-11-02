// The app's shared state and the helpers every area uses.
// Each area module (sidebar.js, chat.js, ...) declares its own state keys and adds its actions to
// the `app` object made here, so areas can call each other without importing each other.
//
// The state is shallowReactive: every top-level key is tracked on its own, so a view only
// recomputes when a key it reads changes. Values are still replaced, never mutated in place
// (setState works like React's), because nested objects and arrays aren't reactive.

const { shallowReactive, computed } = Vue;

export const ACCENT = '#6D28FF'; // Proxi's brand color

export const coreState = {
  convs: [],
  activeId: null,
  view: 'new', // 'new', 'chat', 'settings' or 'privacy'
  toast: ''
};

export function createStore(user, initial) {
  const state = shallowReactive({ ...initial });
  const timers = [];
  let id = 100;
  let toastTimer = null;

  const app = {
    state,
    user,
    // The DOM elements areas hand each other (the message box, the file picker, ...).
    els: {},
    // Where focus goes back to when a dialog closes.
    returnFocus: null,

    setState(update) {
      const patch = typeof update === 'function' ? update(state) : update;
      if (patch) Object.assign(state, patch);
    },

    nextId: () => id++,

    later(fn, ms) {
      const t = setTimeout(() => {
        timers.splice(timers.indexOf(t), 1);
        fn();
      }, ms);
      timers.push(t);
      return t;
    },

    clearTimers() {
      timers.forEach((t) => clearTimeout(t));
      timers.length = 0;
    },

    showToast(text) {
      clearTimeout(toastTimer);
      app.setState({ toast: text });
      toastTimer = app.later(() => app.setState({ toast: '' }), Math.min(8000, Math.max(2200, text.length * 55)));
    },

    // Switches view, closing every menu (and the sidebar on a phone).
    go(patch) {
      app.setState({ chatMenu: false, shareMenu: false, modelMenu: false, userMenu: false, narrowNav: false, ...patch });
    },

    isNarrow() {
      try { return window.matchMedia('(max-width: 830px)').matches; } catch (e) { return false; }
    },

    copyText(text) {
      try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } catch (e) {}
    },

    // Which screen is showing. Computed once and shared, so the areas that only need to know
    // "is this a chat" don't recompute while a reply streams in.
    activeConv: computed(() => state.convs.find((c) => c.id === state.activeId)),
    isChat: computed(() => state.view === 'chat' && !!app.activeConv.value),
    isNew: computed(() => state.view === 'new' || (state.view === 'chat' && !app.activeConv.value)),
    activeIncognito: computed(() => !!app.activeConv.value?.temporary)
  };
  return app;
}
