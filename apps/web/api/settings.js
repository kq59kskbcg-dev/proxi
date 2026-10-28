import { requireUser } from '../lib/auth.js';
import { hasDatabase, getSettings, saveSettings, RETENTION_OPTIONS } from '../lib/db.js';

// GET: the signed-in user's settings. PUT: change them.
export async function GET(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'Settings are not set up yet.' }, 503);
  try {
    return json({ ...(await getSettings(user.userId)), retentionOptions: RETENTION_OPTIONS });
  } catch (error) {
    console.error('settings GET failed', error?.code ?? error?.name);
    return json({ error: 'Could not load your settings.' }, 500);
  }
}

export async function PUT(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'Settings are not set up yet.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const days = body?.chatRetentionDays;
  if (!RETENTION_OPTIONS.includes(days)) return json({ error: 'Invalid request.' }, 400);
  try {
    await saveSettings(user.userId, { chatRetentionDays: days });
    return json(await getSettings(user.userId));
  } catch (error) {
    console.error('settings PUT failed', error?.code ?? error?.name);
    return json({ error: 'Could not save your settings.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
