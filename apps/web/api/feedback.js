import { getLangfuse } from '@proxi/agent/langfuse';
import { log } from '@proxi/agent/log';
import { rateLimit } from '../lib/ratelimit.js';
import { requireUser } from '../lib/auth.js';

// Thumbs up / down from the chat, stored as a Langfuse score on the reply's trace.
export async function POST(request) {
  const user = await requireUser(request);
  if (!user.userId) return new Response(null, { status: user.status });
  if (!(await rateLimit('feedback:' + user.userId)).ok) return new Response(null, { status: 429 });
  let body;
  try { body = await request.json(); } catch { return new Response(null, { status: 400 }); }
  const { traceId, value } = body || {};
  if (typeof traceId !== 'string' || !/^[\w-]{8,64}$/.test(traceId) || ![1, 0, null].includes(value)) {
    return new Response(null, { status: 400 });
  }
  const langfuse = getLangfuse();
  if (langfuse && value !== null) {
    // A lost score isn't worth failing the click for, but it is logged.
    try {
      await langfuse.score.create({ traceId, name: 'user-feedback', value, dataType: 'BOOLEAN' });
      await langfuse.flush();
    } catch (error) {
      log.error('feedback.score_failed', { error, traceId });
    }
  }
  return new Response(null, { status: 204 });
}
