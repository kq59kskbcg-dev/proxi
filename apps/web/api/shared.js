import { rateLimit } from '../lib/ratelimit.js';
import { SHARE_ID, hasDatabase, getSharedConversation } from '../lib/db.js';

// GET ?id=: a shared chat, for anyone with the link. No sign-in. Not cached, so
// "Stop sharing" takes effect right away, and kept out of search engines.
export async function GET(request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (!rateLimit('shared:' + ip).ok) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
  if (!hasDatabase()) return json({ error: 'Not found.' }, 404);

  const id = new URL(request.url, 'http://localhost').searchParams.get('id');
  if (!id || !SHARE_ID.test(id)) return json({ error: 'Not found.' }, 404);
  try {
    const chat = await getSharedConversation(id);
    if (!chat) return json({ error: 'Not found.' }, 404);
    return json(chat);
  } catch (error) {
    console.error('shared GET failed', error);
    return json({ error: 'Could not load this chat.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}
