// Chat search: Ctrl/Cmd+K, a filtered list of saved chats, and keyboard picking.

import { highlight, groupOf, fullDate } from './format.js';

export const searchState = {
  searchOpen: false,
  query: '',
  searchSel: 0
};

export function createSearch(app) {
  const s = app.state;
  let searchEl = null;
  let needsFocus = false;

  const onGlobalKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (s.searchOpen) closeSearch(); else openSearch();
    }
  };

  function openSearch() {
    app.returnFocus = document.activeElement;
    needsFocus = true;
    app.go({ searchOpen: true, query: '', searchSel: 0 });
    app.later(() => { if (searchEl) searchEl.focus(); }, 0);
  }

  function closeSearch() {
    app.setState({ searchOpen: false, query: '', searchSel: 0 });
    const back = app.returnFocus;
    app.returnFocus = null;
    if (back && back.focus) app.later(() => back.focus(), 0);
  }

  function searchMatches() {
    const q = s.query.trim().toLowerCase();
    return s.convs.filter((c) => !c.temporary && (!q || c.title.toLowerCase().includes(q))).slice(0, 200);
  }

  function pickSearchResult(id) {
    app.setState({ searchOpen: false, query: '', searchSel: 0 });
    app.returnFocus = null;
    app.openConversation(id);
  }

  function onSearchKey(e) {
    const count = searchMatches().length;
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
    else if (e.key === 'ArrowDown' && count) { e.preventDefault(); app.setState({ searchSel: (s.searchSel + 1) % count }); }
    else if (e.key === 'ArrowUp' && count) { e.preventDefault(); app.setState({ searchSel: (s.searchSel - 1 + count) % count }); }
    else if (e.key === 'Enter' && count) {
      e.preventDefault();
      const pick = searchMatches()[Math.min(s.searchSel, count - 1)];
      if (pick) pickSearchResult(pick.id);
    }
  }

  const searchRef = (el) => { searchEl = el; if (el && needsFocus) { needsFocus = false; el.focus(); } };
  const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';

  return {
    actions: { openSearch },
    mounted() { window.addEventListener('keydown', onGlobalKey); },
    unmounted() { window.removeEventListener('keydown', onGlobalKey); },

    views: {
      search: () => {
        const q = s.query.trim().toLowerCase();
        const searchList = s.searchOpen ? searchMatches() : [];
        return {
          searchOpen: s.searchOpen,
          openSearch,
          closeSearch,
          searchBackdrop: (e) => { if (e.target === e.currentTarget) closeSearch(); },
          searchRef,
          searchShortcut,
          query: s.query,
          onQuery: (e) => app.setState({ query: e.target.value, searchSel: 0 }),
          onSearchKey,
          searchLabel: q ? (searchList.length === 1 ? '1 CHAT' : `${searchList.length} CHATS`) : '',
          searchEmpty: !searchList.length ? (q ? `No chats match "${s.query.trim()}".` : 'No saved chats yet.') : '',
          searchResults: searchList.map((c, i) => ({
            key: c.id,
            parts: highlight(c.title, q),
            when: fullDate(c.updatedAt),
            group: !q && groupOf(c.updatedAt) !== (i ? groupOf(searchList[i - 1].updatedAt) : null) ? groupOf(c.updatedAt) : '',
            selected: i === Math.min(s.searchSel, searchList.length - 1) ? 'true' : 'false',
            open: () => pickSearchResult(c.id),
            hover: () => { if (s.searchSel !== i) app.setState({ searchSel: i }); }
          }))
        };
      }
    }
  };
}
