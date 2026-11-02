import { requireUser } from '../lib/auth.js';
import { hasDatabase, getRedactionCounts } from '../lib/db.js';
import { summarizeRedactions } from '../lib/privacy.js';

// GET: what Proxi redacted from the signed-in user's messages, this month and all time.
export async function GET(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'The privacy page is not set up yet.' }, 503);
  try {
    return json(summarizeRedactions(await getRedactionCounts(user.userId)));
  } catch (error) {
    console.error('privacy GET failed', error?.code ?? error?.name);
    return json({ error: 'Could not load your privacy summary.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
