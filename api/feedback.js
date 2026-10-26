import { getLangfuse } from '../lib/langfuse.js';
import { rateLimit } from '../lib/ratelimit.js';

// Thumbs up / down from the chat, stored as a Langfuse score on the reply's trace.
export async function POST(request) {
  if (!rateLimit(request).ok) return new Response(null, { status: 429 });
  let body;
  try { body = await request.json(); } catch { return new Response(null, { status: 400 }); }
  const { traceId, value } = body || {};
  if (typeof traceId !== 'string' || !/^[\w-]{8,64}$/.test(traceId) || ![1, 0, null].includes(value)) {
    return new Response(null, { status: 400 });
  }
  const langfuse = getLangfuse();
  if (langfuse && value !== null) {
    langfuse.score({ traceId, name: 'user-feedback', value, dataType: 'BOOLEAN' });
    await langfuse.flushAsync().catch(() => {});
  }
  return new Response(null, { status: 204 });
}
