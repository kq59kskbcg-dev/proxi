import { log } from '@proxi/agent/log';
import { json, withUser } from '../lib/http.js';
import { hasDatabase, getSettings, saveSettings, RETENTION_OPTIONS, CUSTOM_INSTRUCTIONS_MAX } from '../lib/db.js';

// GET: the signed-in user's settings. PUT: change any of them; the rest stay as they are.
export const GET = withUser(async (request, user) => {
  if (!hasDatabase()) return json({ error: 'Settings are not set up yet.' }, 503);
  try {
    return json({ ...(await getSettings(user.userId)), retentionOptions: RETENTION_OPTIONS, customInstructionsMax: CUSTOM_INSTRUCTIONS_MAX });
  } catch (error) {
    log.error('settings.get_failed', { error });
    return json({ error: 'Could not load your settings.' }, 500);
  }
});

export const PUT = withUser(async (request, user) => {
  if (!hasDatabase()) return json({ error: 'Settings are not set up yet.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const days = body?.chatRetentionDays;
  const instructions = typeof body?.customInstructions === 'string' ? body.customInstructions.trim() : body?.customInstructions;
  if (days === undefined && instructions === undefined) return json({ error: 'Invalid request.' }, 400);
  if (days !== undefined && !RETENTION_OPTIONS.includes(days)) return json({ error: 'Invalid request.' }, 400);
  if (instructions !== undefined && (typeof instructions !== 'string' || instructions.length > CUSTOM_INSTRUCTIONS_MAX)) {
    return json({ error: `Custom instructions can be up to ${CUSTOM_INSTRUCTIONS_MAX} characters.` }, 400);
  }
  try {
    await saveSettings(user.userId, { chatRetentionDays: days, customInstructions: instructions });
    return json(await getSettings(user.userId));
  } catch (error) {
    log.error('settings.put_failed', { error });
    return json({ error: 'Could not save your settings.' }, 500);
  }
});
