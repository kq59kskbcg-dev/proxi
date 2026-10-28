import { hasDatabase, deleteInactiveConversations } from '../lib/db.js';

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
    const deleted = await deleteInactiveConversations();
    console.log(`retention: deleted ${deleted} inactive chat(s)`);
    return json({ deleted });
  } catch (error) {
    console.error('retention cleanup failed', error?.code ?? error?.name);
    return json({ error: 'Cleanup failed.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
