import { createClerkClient } from '@clerk/backend';
import { deleteTraces } from '@proxi/agent/langfuse';
import { requireUser } from '../lib/auth.js';
import { rateLimit } from '../lib/ratelimit.js';
import { hasDatabase, deleteAccountData } from '../lib/db.js';

// DELETE: deletes the signed-in user's chats, memories, settings and monitoring traces,
// then their account. The account goes last, so a failure part-way can be retried.
export async function DELETE(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!rateLimit('account:' + user.userId).ok) return json({ error: 'Too many requests. Try again in a few minutes.' }, 429);
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return json({ error: 'Account deletion is not set up yet.' }, 503);

  try {
    if (hasDatabase()) await deleteTraces(await deleteAccountData(user.userId));
    await (clerk ?? createClerkClient({ secretKey })).users.deleteUser(user.userId);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('account DELETE failed', error?.code ?? error?.name);
    return json({ error: 'Could not delete your account. Please try again.' }, 500);
  }
}

// Tests swap in a fake Clerk client.
let clerk = null;
export function setClerk(client) { clerk = client; }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
