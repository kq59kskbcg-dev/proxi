import { deleteTraces, listChatTraces } from '@proxi/agent/langfuse';
import { hasDatabase, deleteInactiveConversations, existingConversationIds } from '../lib/db.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TRACE_PAGES = 20; // up to 2,000 traces checked per run; a longer backlog drains over several days

// Run once a day by a Vercel Cron Job (see vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>"; anything else is refused, and without
// CRON_SECRET set nobody can run it.
export async function GET(request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return json({ error: 'Not allowed.' }, 401);
  }
  if (!hasDatabase()) return json({ error: 'Chat history is not set up yet.' }, 503);

  try {
    // Each user's "Delete chats after" setting, or the default. Both are described
    // on the help center's Privacy page and in the privacy policy.
    const { deleted, traceIds } = await deleteInactiveConversations();
    await deleteTraces(traceIds);
    console.log(`retention: deleted ${deleted} inactive chat(s)`);
    const orphanTraces = await deleteOrphanTraces();
    return json({ deleted, orphanTraces });
  } catch (error) {
    console.error('retention cleanup failed', error?.code ?? error?.name);
    return json({ error: 'Cleanup failed.' }, 500);
  }
}

// Deletes chat traces whose chat no longer exists: chats deleted before their traces were
// deleted with them, or a trace deletion that failed. Traces under a day old are left alone,
// since their chat may not be saved yet. A failure here never fails the retention run.
export async function deleteOrphanTraces({ now = Date.now(), maxPages = MAX_TRACE_PAGES } = {}) {
  const before = new Date(now - DAY_MS);
  let cursor = null;
  let removed = 0;
  try {
    for (let page = 0; page < maxPages; page++) {
      const { traces, cursor: next } = await listChatTraces({ before, cursor });
      const sessions = [...new Set(traces.map((t) => t.sessionId).filter(Boolean))];
      const kept = new Set(await existingConversationIds(sessions));
      const orphans = traces.filter((t) => !t.sessionId || !kept.has(t.sessionId)).map((t) => t.traceId);
      await deleteTraces(orphans);
      removed += orphans.length;
      if (!next) break;
      cursor = next;
    }
    if (removed) console.log(`retention: deleted ${removed} trace(s) of chats that no longer exist`);
  } catch (error) {
    console.error('orphan trace cleanup failed', error?.name);
  }
  return removed;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
