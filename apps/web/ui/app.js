// The Proxi app: signs in with Clerk and mounts the chat UI, or shows a shared chat (/s/<id>).
// Vue, Clerk and the theme helper are globals set up by index.html before this module runs.
//
// The UI is one Vue template (#tpl in index.html) that reads everything from `v`. Each area of the
// app (sidebar.js, chat.js, settings.js, ...) owns its state keys and actions, and provides views:
// functions that return the values `v` shows. Every view is its own computed, so typing in the
// message box, say, doesn't rebuild the chat's messages.

import { trackViewport } from './browser.js';
import { createStore, coreState, ACCENT } from './store.js';
import { layoutState, createLayout } from './layout.js';
import { sidebarState, createSidebar } from './sidebar.js';
import { searchState, createSearch } from './search.js';
import { composerState, createComposer } from './composer.js';
import { chatState, createChat } from './chat.js';
import { shareState, createShare } from './share.js';
import { settingsState, createSettings } from './settings.js';
import { memoriesState, createMemories } from './memories.js';
import { accountState, createAccount } from './account.js';
import { privacyState, createPrivacyPage } from './privacy-page.js';
import { startShared } from './shared-page.js';

const { createApp, computed, onMounted, onUpdated, onBeforeUnmount } = Vue;

// The composer comes before the chat: it sizes the message box after an update, and the chat
// then keeps the messages scrolled to the bottom of the space that's left.
const AREAS = [
  [layoutState, createLayout],
  [sidebarState, createSidebar],
  [searchState, createSearch],
  [composerState, createComposer],
  [chatState, createChat],
  [shareState, createShare],
  [settingsState, createSettings],
  [memoriesState, createMemories],
  [privacyState, createPrivacyPage],
  [accountState, createAccount]
];

function mount(user) {
  const app = createStore(user, Object.assign({}, coreState, ...AREAS.map(([state]) => state)));
  const areas = AREAS.map(([, create]) => create(app));
  for (const area of areas) {
    for (const [name, fn] of Object.entries(area.actions || {})) {
      if (name in app) throw new Error('Two areas define ' + name);
      app[name] = fn;
    }
  }
  const run = (hook) => areas.forEach((area) => area[hook] && area[hook]());

  createApp({
    template: '#tpl',
    setup() {
      // `v` reads each value from the view that provides it, so the template only depends on
      // the views it shows.
      const v = {};
      for (const area of areas) {
        for (const view of Object.values(area.views || {})) {
          const vals = computed(view);
          for (const key of Object.keys(vals.value)) {
            if (key in v) throw new Error('Two views provide v.' + key);
            Object.defineProperty(v, key, { enumerable: true, get: () => vals.value[key] });
          }
        }
      }
      onMounted(() => run('mounted'));
      onUpdated(() => run('updated'));
      onBeforeUnmount(() => {
        app.clearTimers();
        run('unmounted');
      });
      return { v };
    }
  }).mount('#app');
}

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

async function start() {
  const shared = location.pathname.match(/^\/s\/([\w-]{22})\/?$/);
  if (shared) return startShared(shared[1]);
  const clerk = window.Clerk;
  clearSharedClerkToken();
  await clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    appearance: { variables: { colorPrimary: ACCENT, fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '10px' } }
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
  const user = {
    name: clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || 'Signed in',
    image: clerk.user.hasImage ? clerk.user.imageUrl : ''
  };
  mount(user);
}
start();
