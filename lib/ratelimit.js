// Simple per-visitor limit. It lives in each function instance's memory, so it
// slows down abuse rather than enforcing a hard global cap; the spend limit in
// the Anthropic Console is the hard cap.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 20;
const hits = new Map();

export function rateLimit(request) {
  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(ip, recent);
    return { ok: false, retryAfter: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return { ok: true };
}
