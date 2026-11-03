import { createHash } from 'node:crypto';
import { log } from '@proxi/agent/log';
import { hasDatabase, hitRateLimit } from './db.js';

// Per-key limit (a user ID, or a hashed IP address for public pages, with a route prefix).
// With a database it is shared by every instance of the app; without one, or if the database
// can't be reached, each instance keeps its own count in memory. The spend limit in the
// Anthropic Console is the hard cap on cost either way.
export const WINDOW_MS = 10 * 60 * 1000;
export const MAX_REQUESTS = 20;
// Keys kept in memory at most. Past this, the keys idle the longest go first, so a flood of
// new keys (say, rotating IP addresses) can't reset the limit of everyone else at once.
export const MAX_KEYS = 5000;

// Resolves to { ok: true } or { ok: false, retryAfter } in seconds.
export async function rateLimit(key, now = Date.now()) {
  if (!hasDatabase()) return memoryRateLimit(key, now);
  try {
    const { ok, oldest } = await hitRateLimit(key, { now, windowMs: WINDOW_MS, max: MAX_REQUESTS });
    return ok ? { ok } : { ok, retryAfter: Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000)) };
  } catch (error) {
    log.warn('ratelimit.db_failed', { error });
    return memoryRateLimit(key, now);
  }
}

// IP addresses are personal data, so only a hash of one is used as a key.
export function ipKey(prefix, request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  return prefix + createHash('sha256').update(ip).digest('base64url').slice(0, 22);
}

// key -> times of recent allowed requests. A Map keeps insertion order, and every request
// moves its key to the end, so the first keys are always the least recently active.
const hits = new Map();

export function memoryRateLimit(key, now = Date.now()) {
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
