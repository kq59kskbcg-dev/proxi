// Shows a streamed reply one word at a time at a steady pace, however the text arrives: a big
// cited passage that comes in one piece appears at the same speed as everything else. Each new
// word fades in. With "reduce motion" on, text shows as it arrives, without the fade.

export const REVEAL_MS = 25; // per word
export const FADE_MS = 150; // matches .fade-w in style.css

// Splits text into words, each with the spaces and line breaks around it, so joining the pieces
// gives back the text exactly.
export function splitWords(text) {
  return String(text).match(/\s*\S+\s*|\s+/g) || [];
}

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

// A buffer for one reply. push(text) adds what arrived; show(text) is called with each word in
// order. flush() shows everything still waiting at once; drop() discards it. idle() resolves when
// nothing is waiting.
export function createReveal({ show, pace = REVEAL_MS, instant = false, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let queue = [];
  let timer = null;
  let waiting = [];

  const settle = () => {
    if (timer || queue.length) return;
    const done = waiting;
    waiting = [];
    done.forEach((resolve) => resolve());
  };
  const next = () => {
    if (timer) return;
    if (!queue.length) return settle();
    if (instant) {
      const text = queue.join('');
      queue = [];
      show(text);
      return settle();
    }
    timer = setTimer(() => {
      timer = null;
      show(queue.shift());
      next();
    }, pace);
  };
  const cancel = () => {
    if (timer) clearTimer(timer);
    timer = null;
  };

  return {
    push(text) {
      queue.push(...splitWords(text));
      next();
    },
    flush() {
      cancel();
      const text = queue.join('');
      queue = [];
      if (text) show(text);
      settle();
    },
    drop() {
      cancel();
      queue = [];
      settle();
    },
    idle() {
      return new Promise((resolve) => { waiting.push(resolve); settle(); });
    },
    get pending() { return queue.length; }
  };
}

// Which parts of a reply's rendered text are still fading in. The reply is rendered again for each
// new word, which would restart every fade, so this remembers when each stretch of text first
// appeared and the fade continues from there. Offsets count characters of the element's text.
export function createFadeTracker({ duration = FADE_MS, now = () => performance.now() } = {}) {
  let seen = 0;
  let parts = []; // { start, end, at }
  return {
    // The stretches to fade for text that is now `length` characters long, each with how far
    // into its fade it already is.
    update(length) {
      const t = now();
      if (length < seen) parts = parts.map((p) => ({ ...p, end: Math.min(p.end, length) })).filter((p) => p.start < p.end);
      if (length > seen) parts.push({ start: seen, end: length, at: t });
      seen = length;
      parts = parts.filter((p) => t - p.at < duration);
      return parts.map((p) => ({ start: p.start, end: p.end, elapsed: t - p.at }));
    },
    reset() { seen = 0; parts = []; }
  };
}

// Wraps the given stretches of `el`'s text in fading spans. Code blocks are left alone so their
// layout doesn't jump.
export function applyFades(el, ranges) {
  if (!ranges.length) return;
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: offset });
    offset += node.data.length;
  }
  for (const { node, start } of nodes) {
    if (node.parentElement && node.parentElement.closest('pre')) continue;
    const end = start + node.data.length;
    const hits = ranges
      .map((r) => ({ from: Math.max(r.start, start) - start, to: Math.min(r.end, end) - start, elapsed: r.elapsed }))
      .filter((r) => r.from < r.to)
      .sort((a, b) => b.from - a.from);
    // From the right, so splitting keeps the earlier offsets in this node valid.
    for (const hit of hits) {
      if (!/\S/.test(node.data.slice(hit.from, hit.to))) continue;
      if (hit.to < node.data.length) node.splitText(hit.to);
      const piece = hit.from > 0 ? node.splitText(hit.from) : node;
      const span = document.createElement('span');
      span.className = 'fade-w';
      span.style.animationDelay = -Math.round(hit.elapsed) + 'ms';
      piece.parentNode.insertBefore(span, piece);
      span.appendChild(piece);
    }
  }
}
