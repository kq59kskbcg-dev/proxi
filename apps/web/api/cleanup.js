import { hasDatabase, deleteInactiveConversations } from '../lib/db.js';

// Chats with no activity for this many days are deleted. Shown on the help
// center's Privacy page and in the privacy policy, so change them together.
export const RETENTION_DAYS = 90;

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
    const deleted = await deleteInactiveConversations(RETENTION_DAYS);
    console.log(`retention: deleted ${deleted} chat(s) inactive for ${RETENTION_DAYS}+ days`);
    return json({ deleted });
  } catch (error) {
    console.error('retention cleanup failed', error?.code ?? error?.name);
    return json({ error: 'Cleanup failed.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
