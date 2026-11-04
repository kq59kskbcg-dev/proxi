// The frame around every screen: the sidebar opening and closing, the menu overlay, the header
// border and the toast.

import { ACCENT } from './store.js';

export const layoutState = {
  collapsed: false,
  narrowNav: false
};

export function createLayout(app) {
  const s = app.state;
  let mq = null;
  let onBreakpoint = null;
  let resizeTimer = null;

  return {
    // Crossing the mobile breakpoint: close the mobile menu and skip the slide animations.
    mounted() {
      try {
        mq = window.matchMedia('(max-width: 830px)');
        onBreakpoint = () => {
          document.documentElement.classList.add('resizing');
          app.setState({ narrowNav: false });
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => document.documentElement.classList.remove('resizing'), 350);
        };
        mq.addEventListener('change', onBreakpoint);
      } catch (e) {}
    },
    unmounted() {
      if (mq) mq.removeEventListener('change', onBreakpoint);
    },

    views: {
      layout: () => {
        const isNew = app.isNew.value;
        const isSettings = s.view === 'settings'; // Settings is its own screen, without the sidebar
        return {
          accent: ACCENT,
          anyMenu: s.modelMenu || s.chatMenu || s.shareMenu || s.userMenu,
          closeMenus: () => app.setState({ modelMenu: false, chatMenu: false, shareMenu: false, userMenu: false }),
          showNav: !isSettings,
          navClass: s.narrowNav ? 'side open' : (s.collapsed ? 'side collapsed' : 'side'),
          narrowNav: s.narrowNav,
          menuBtnDisplay: s.collapsed ? 'flex' : 'none',
          collapse: () => (app.isNarrow() ? app.setState({ narrowNav: false }) : app.setState({ collapsed: true })),
          openNav: () => (app.isNarrow() ? app.setState({ narrowNav: true, collapsed: false }) : app.setState({ collapsed: false })),
          isChat: app.isChat.value,
          isNew,
          isSettings,
          headerBorder: isNew ? 'var(--surface)' : 'var(--divider)',
          hasToast: !!s.toast,
          toast: s.toast
        };
      }
    }
  };
}
