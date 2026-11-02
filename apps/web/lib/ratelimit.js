// Simple per-key limit (a user ID, or an IP address for public pages). It lives in
// each function instance's memory, so it slows down abuse rather than enforcing a
// hard global cap; the spend limit in the Anthropic Console is the hard cap.
export const WINDOW_MS = 10 * 60 * 1000;
export const MAX_REQUESTS = 20;
// Keys kept at most. Past this, the keys idle the longest go first, so a flood of new
// keys (say, rotating IP addresses) can't reset the limit of everyone else at once.
export const MAX_KEYS = 5000;

// key -> timestamps of recent requests. A Map keeps insertion order, and every request
// moves its key to the end, so the first keys are always the least recently active.
const hits = new Map();

export function rateLimit(key, now = Date.now()) {
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  hits.delete(key);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(key, recent);
    evict(now);
    return { ok: false, retryAfter: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  evict(now);
  return { ok: true };
}

function evict(now) {
  for (const [key, times] of hits) {
    const expired = now - times[times.length - 1] >= WINDOW_MS;
    if (!expired && hits.size <= MAX_KEYS) break;
    hits.delete(key);
  }
}

// For tests.
export function resetRateLimits() { hits.clear(); }
export function trackedKeys() { return hits.size; }
