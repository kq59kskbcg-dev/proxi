// Sharing a chat: the Share button in the header, creating and copying the link, and stopping.

import { api } from './api.js';
import { shareUrl } from './format.js';

export const shareState = {
  shareMenu: false
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
      app.setState((st) => ({ convs: st.convs.map((c) => (c.id === id ? { ...c, shareId: null } : c)) }));
      app.showToast('Stopped sharing. The link no longer works.');
    } catch (e) {
      app.showToast("Couldn't stop sharing. Try again.");
    }
  }

  return {
    views: {
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
