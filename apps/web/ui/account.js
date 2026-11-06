// The account: the user menu at the bottom of the sidebar (Settings, Help Center, Logout),
// and deleting the account from Settings.

import { DOCS_URL } from './citations.js';
import { api } from './api.js';

export const accountState = {
  userMenu: false,
  deleteAccountOpen: false,
  deletingAccount: false
};

export function createAccount(app) {
  const s = app.state;
  let cancelDeleteEl = null;

  function askDeleteAccount() {
    app.returnFocus = document.activeElement;
    app.setState({ deleteAccountOpen: true });
    app.later(() => { if (cancelDeleteEl) cancelDeleteEl.focus(); }, 0);
  }

  function closeDeleteAccount() {
    if (s.deletingAccount) return;
    app.setState({ deleteAccountOpen: false });
    const back = app.returnFocus;
    app.returnFocus = null;
    if (back && back.focus) app.later(() => back.focus(), 0);
  }

  // Deletes everything stored for this user, then signs out.
  async function deleteAccount() {
    if (s.deletingAccount) return;
    app.setState({ deletingAccount: true });
    try {
      await api.delete('/api/account');
    } catch {
      app.setState({ deletingAccount: false });
      app.showToast("Couldn't delete your account. Please try again.");
      return;
    }
    try { await window.Clerk.signOut({ redirectUrl: location.origin + '/' }); } catch { location.href = '/'; }
  }

  async function logout() {
    app.setState({ userMenu: false });
    try {
      await window.Clerk.signOut({ redirectUrl: location.origin + '/' });
    } catch (e) {
      app.showToast("Couldn't log out. Please try again.");
    }
  }

  const user = app.user;
  const userInitial = (user.name || '?').trim().charAt(0).toUpperCase();
  const cancelDeleteRef = (el) => { cancelDeleteEl = el; };

  return {
    views: {
      account: () => ({
        deleteAccountOpen: s.deleteAccountOpen,
        deletingAccount: s.deletingAccount,
        deleteAccountLabel: s.deletingAccount ? 'Deleting...' : 'Delete account',
        askDeleteAccount,
        cancelDeleteAccount: closeDeleteAccount,
        confirmDeleteAccount: deleteAccount,
        deleteAccountBackdrop: (e) => { if (e.target === e.currentTarget) closeDeleteAccount(); },
        deleteAccountKey: (e) => { if (e.key === 'Escape') { e.preventDefault(); closeDeleteAccount(); } },
        cancelDeleteRef,

        userName: user.name,
        // Settings shows the email under the name, unless the name already is the email.
        userEmailLine: user.email && user.email !== user.name ? user.email : '',
        userImage: user.image,
        userInitial,
        userMenu: s.userMenu,
        userMenuExpanded: s.userMenu ? 'true' : 'false',
        toggleUserMenu: () => app.setState({ userMenu: !s.userMenu, chatMenu: false, shareMenu: false, modelMenu: false }),
        docsHome: DOCS_URL,
        docsIncognito: DOCS_URL + '/privacy#incognito-chats',
        privacyPolicy: DOCS_URL + '/privacy-policy',
        terms: DOCS_URL + '/terms',
        closeUserMenu: () => app.setState({ userMenu: false }),
        logout
      })
    }
  };
}
