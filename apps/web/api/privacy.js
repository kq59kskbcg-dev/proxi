import { log } from '@proxi/agent/log';
import { json, withUser } from '../lib/http.js';
import { hasDatabase, getRedactionCounts } from '../lib/db.js';
import { summarizeRedactions } from '../lib/privacy.js';

// GET: what Proxi redacted from the signed-in user's messages, this month and all time.
export const GET = withUser(async (request, user) => {
  if (!hasDatabase()) return json({ error: 'The privacy page is not set up yet.' }, 503);
  try {
    return json(summarizeRedactions(await getRedactionCounts(user.userId)));
  } catch (error) {
    log.error('privacy.get_failed', { error });
    return json({ error: 'Could not load your privacy summary.' }, 500);
  }
});
