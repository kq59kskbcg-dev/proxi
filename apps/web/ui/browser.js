// Helpers that talk to the browser.

// The visible viewport shrinks when the browser bar shows or the keyboard opens, and
// on iOS it also pans. Tracking it keeps the app exactly the size of what is visible.
export function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let frame = 0;
  const apply = () => {
    frame = 0;
    if (vv.scale > 1.01) { // pinch-zoomed: leave sizing to the browser
      root.style.removeProperty('--app-h');
      root.style.removeProperty('--app-top');
      return;
    }
    root.style.setProperty('--app-h', vv.height + 'px');
    root.style.setProperty('--app-top', vv.offsetTop + 'px');
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  apply();
}

// Resolves once the page is showing. A hidden tab can't be relied on to keep a connection open.
export function whenVisible() {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', on);
      resolve();
    };
    document.addEventListener('visibilitychange', on);
  });
}
