// The sidebar: New chat, Privacy, the recent chats, and loading the saved chat list.

import { api, ApiError } from './api.js';

const RECENTS_SHOWN = 10; // chats listed in the sidebar; "View all" opens search

export const sidebarState = {
  history: 'loading', // 'loading', 'ok', 'off' (no database) or 'error'
  historyRef: ''
};

export function createSidebar(app) {
  const s = app.state;

  // The signed-in user's saved chats, newest first. Messages load when a chat is opened.
  async function loadConversations() {
    app.setState({ history: 'loading' });
    try {
      const { conversations } = await api.get('/api/conversations');
      const today = new Date().toDateString();
      app.setState((st) => {
        const known = new Set(st.convs.map((c) => c.id));
        const saved = conversations.filter((c) => !known.has(c.id)).map((c) => ({
          id: c.id, title: c.title, updatedAt: c.updatedAt, group: new Date(c.updatedAt).toDateString() === today ? 'Today' : 'Earlier', messages: [], loaded: false, shareId: c.shareId || null
        }));
        return { convs: [...st.convs, ...saved], history: 'ok' };
      });
      // A cited chat opened in a new tab arrives as /?chat=<id>.
      const linked = new URLSearchParams(location.search).get('chat');
      if (linked) {
        window.history.replaceState(null, '', '/');
        app.openCitedChat(linked);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) return app.setState({ history: 'off' });
      // A short, safe reference (status and database error code) to help find the cause.
      if (e instanceof ApiError) return app.setState({ history: 'error', historyRef: [e.status, e.data.code || e.data.kind].filter(Boolean).join(' · ') });
      console.error('Loading chats failed:', e);
      app.setState({ history: 'error', historyRef: 'network' });
    }
  }

  return {
    actions: { loadConversations },
    mounted: loadConversations,

    views: {
      sidebar: () => {
        const isChat = app.isChat.value;
        const isNew = app.isNew.value;
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
            open: () => app.openConversation(c.id)
          };
        };
        // Incognito (temporary) chats are never listed: they exist only until the page reloads.
        const list = s.convs.filter((c) => !c.temporary);
        const nav = {};
        [['new', isNew], ['privacy', s.view === 'privacy']].forEach(([k, on]) => {
          nav[k + 'Cls'] = on ? '' : 'hov';
          nav[k + 'Cur'] = on ? 'page' : 'false';
          nav[k + 'Bg'] = on ? 'var(--sunken)' : 'transparent';
          nav[k + 'Shadow'] = 'none';
        });
        return {
          nav,
          newChat: () => { app.go({ view: 'new', activeId: null, draft: '' }); app.focusComposer(); },
          navScroll: (e) => { e.currentTarget.previousElementSibling?.classList.toggle('scrolled', e.currentTarget.scrollTop > 0); },
          recents: list.slice(0, RECENTS_SHOWN).map(item),
          hasMore: list.length > RECENTS_SHOWN,
          recentsEmpty: !q && s.history === 'ok' && !list.length,
          historyLoading: !q && s.history === 'loading' && !list.length,
          historyNote: q ? '' : s.history === 'off' ? "Chat history isn't set up yet, so chats aren't saved."
            : s.history === 'error' ? "Couldn't load your previous chats" + (s.historyRef ? ' (error ' + s.historyRef + ').' : '.') : '',
          historyRetry: s.history === 'error' ? () => loadConversations() : null
        };
      }
    }
  };
}
