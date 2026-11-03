import { createClerkClient } from '@clerk/backend';
import { deleteTraces } from '@proxi/agent/langfuse';
import { log } from '@proxi/agent/log';
import { json, withUser } from '../lib/http.js';
import { rateLimit } from '../lib/ratelimit.js';
import { hasDatabase, deleteAccountData } from '../lib/db.js';

// DELETE: deletes the signed-in user's chats, memories, settings and monitoring traces,
// then their account. The account goes last, so a failure part-way can be retried.
export const DELETE = withUser(async (request, user) => {
  if (!(await rateLimit('account:' + user.userId)).ok) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return json({ error: 'Account deletion is not set up yet.' }, 503);

  try {
    if (hasDatabase()) await deleteTraces(await deleteAccountData(user.userId));
    await (clerk ?? createClerkClient({ secretKey })).users.deleteUser(user.userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    log.error('account.delete_failed', { error });
    return json({ error: 'Could not delete your account. Please try again.' }, 500);
  }
});

// Tests swap in a fake Clerk client.
let clerk = null;
export function setClerk(client) { clerk = client; }
