import { log } from '@proxi/agent/log';
import { json as baseJson } from '../lib/http.js';
import { rateLimit, ipKey } from '../lib/ratelimit.js';
import { SHARE_ID, hasDatabase, getSharedConversation } from '../lib/db.js';

// GET ?id=: a shared chat, for anyone with the link. No sign-in. Not cached, so
// "Stop sharing" takes effect right away, and kept out of search engines.
export async function GET(request) {
  if (!(await rateLimit(ipKey('shared:', request))).ok) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
  if (!hasDatabase()) return json({ error: 'Not found.' }, 404);

  const id = new URL(request.url, 'http://localhost').searchParams.get('id');
  if (!id || !SHARE_ID.test(id)) return json({ error: 'Not found.' }, 404);
  try {
    const chat = await getSharedConversation(id);
    if (!chat) return json({ error: 'Not found.' }, 404);
    return json(chat);
  } catch (error) {
    log.error('shared.get_failed', { error });
    return json({ error: 'Could not load this chat.' }, 500);
  }
}

// Shared chats are kept out of search engines.
const json = (data, status = 200) => baseJson(data, status, { 'X-Robots-Tag': 'noindex, nofollow' });
