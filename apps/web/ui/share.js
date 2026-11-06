// Sharing a chat: the Share button in the header, creating and copying the link, and stopping.
// Settings also lists every shared link that hasn't expired, from loadSharedLinks.

import { api } from './api.js';
import { shareUrl } from './format.js';

export const shareState = {
  shareMenu: false,
  sharedLinks: null // null until loaded, for Settings
};

export function createShare(app) {
  const s = app.state;

  async function shareChat(id) {
    try {
      const { shareId } = await api.post('/api/share', { id });
      app.setState((st) => ({ convs: st.convs.map((c) => (c.id === id ? { ...c, shareId } : c)) }));
      app.copyText(shareUrl(shareId));
      app.showToast('Link copied. Anyone with the link can view this chat.');
    } catch (e) {
      app.showToast("Couldn't share this chat. Try again.");
    }
  }

  async function stopSharing(id) {
    app.setState({ shareMenu: false });
    try {
      await api.delete('/api/share', { query: { id } });
      app.setState((st) => ({ convs: st.convs.map((c) => (c.id === id ? { ...c, shareId: null } : c)), sharedLinks: st.sharedLinks && st.sharedLinks.filter((l) => l.id !== id) }));
      app.showToast('Stopped sharing. The link no longer works.');
    } catch (e) {
      app.showToast("Couldn't stop sharing. Try again.");
    }
  }

  async function loadSharedLinks() {
    try {
      app.setState({ sharedLinks: (await api.get('/api/share')).links || [] });
    } catch {
      app.setState({ sharedLinks: [] });
      app.showToast("Couldn't load your shared links. Please try again.");
    }
  }

  // Opens a shared chat, even one older than the chats listed in the sidebar.
  function openSharedChat(link) {
    if (!s.convs.some((c) => c.id === link.id)) {
      app.setState((st) => ({ convs: [...st.convs, { id: link.id, title: link.title, updatedAt: '', group: 'Earlier', messages: [], loaded: false, shareId: link.shareId }] }));
    }
    app.openConversation(link.id);
  }

  return {
    actions: { loadSharedLinks },
    views: {
      sharedLinks: () => ({
        sharedLinkItems: (s.sharedLinks || []).map((l) => ({
          key: l.id, title: l.title,
          expires: 'Expires ' + new Date(l.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
          open: () => openSharedChat(l),
          copy: () => { app.copyText(shareUrl(l.shareId)); app.showToast('Link copied'); },
          stop: () => stopSharing(l.id)
        })),
        noSharedLinks: Array.isArray(s.sharedLinks) && s.sharedLinks.length === 0
      }),
      share: () => {
        const conv = app.activeConv.value;
        const shareId = conv?.shareId;
        return {
          canShare: app.isChat.value && !conv?.temporary,
          isShared: !!shareId,
          notShared: !shareId,
          shareBg: shareId ? 'var(--accent-soft)' : 'var(--surface)',
          shareBorder: shareId ? 'var(--accent-line)' : 'var(--border)',
          shareColor: shareId ? 'var(--link)' : 'var(--text)',
          shareHasPopup: shareId ? 'menu' : null,
          shareMenu: s.shareMenu,
          shareMenuExpanded: shareId ? (s.shareMenu ? 'true' : 'false') : null,
          share: () => (shareId ? app.setState({ shareMenu: !s.shareMenu, chatMenu: false, modelMenu: false, userMenu: false }) : shareChat(s.activeId)),
          copyShareLink: () => { app.copyText(shareUrl(shareId)); app.setState({ shareMenu: false }); app.showToast('Link copied'); },
          stopSharing: () => stopSharing(s.activeId)
        };
      }
    }
  };
}
