import { rateLimit } from '../lib/ratelimit.js';

// GET ?host=: a site's icon for the sources list. Proxi's server asks the icon
// service, so the service sees Proxi's address, not the visitor's. No sign-in,
// because shared chats show sources too. Cached by the CDN, so most requests
// never reach this function.
const UPSTREAM = 'https://icons.duckduckgo.com/ip3/';
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const MAX_BYTES = 100 * 1024;
const CACHE_HIT = 'public, max-age=86400, s-maxage=604800';
const CACHE_MISS = 'public, max-age=3600, s-maxage=86400';

export async function GET(request) {
  const host = (new URL(request.url, 'http://localhost').searchParams.get('host') || '').toLowerCase();
  if (!HOST.test(host)) return empty(400, 'no-store');

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (!rateLimit('icon:' + ip, 300).ok) return empty(429, 'no-store');

  try {
    const res = await fetch(UPSTREAM + host + '.ico', { redirect: 'error', signal: AbortSignal.timeout(4000) });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !type.startsWith('image/')) return empty(404, CACHE_MISS);
    const body = await res.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_BYTES) return empty(404, CACHE_MISS);
    return new Response(body, {
      headers: {
        'Content-Type': type,
        'Cache-Control': CACHE_HIT,
        // An SVG icon opened on its own can't run scripts.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch {
    return empty(404, 'no-store');
  }
}

function empty(status, cache) {
  return new Response(null, { status, headers: { 'Cache-Control': cache } });
}
