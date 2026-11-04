import { requireUser } from '../lib/auth.js';
import { CONVERSATION_ID, hasDatabase, listMemories, deleteMemory, markMemory, MEMORY_LIMIT } from '../lib/db.js';
import { saveFromCard } from '../lib/memories.js';
import { MAX_CHAT_MESSAGES } from '../lib/limits.js';

const MEMORY_ID = /^[\w-]{1,64}$/;

// GET: the signed-in user's saved memories.
export async function GET(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'Memory is not set up yet.' }, 503);
  try {
    return json({ memories: await listMemories(user.userId), limit: MEMORY_LIMIT });
  } catch (error) {
    console.error('memories GET failed', error?.code ?? error?.name);
    return json({ error: 'Could not load your memories.' }, 500);
  }
}

// POST { text, conversationId?, position? }: the Save button of a reply's "Save to memory" card.
// Saves the text (which the user may have changed in the card), redacted like messages. In a
// saved chat, the card at `position` is marked as saved. Answers { outcome: "saved" | "duplicate", text },
// or { error: "full" | "invalid" }.
export async function POST(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'unavailable' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid' }, 400); }
  try {
    const { outcome, text } = await saveFromCard(user.userId, body?.text);
    if (outcome === 'invalid') return json({ error: 'invalid' }, 400);
    if (outcome === 'full') return json({ error: 'full', limit: MEMORY_LIMIT }, 409);
    const card = cardOf(body);
    if (card) await markMemory(user.userId, card.conversationId, card.position, 'saved', text);
    return json({ outcome, text });
  } catch (error) {
    console.error('memories POST failed', error?.code ?? error?.name);
    return json({ error: 'failed' }, 500);
  }
}

// PATCH { conversationId, position }: the Not now button of a reply's "Save to memory" card.
// Nothing is saved; the card is marked as declined so it stays that way when the chat is opened again.
export async function PATCH(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'unavailable' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid' }, 400); }
  const card = cardOf(body);
  if (!card) return json({ error: 'invalid' }, 400);
  try {
    await markMemory(user.userId, card.conversationId, card.position, 'declined');
    return json({ ok: true });
  } catch (error) {
    console.error('memories PATCH failed', error?.code ?? error?.name);
    return json({ error: 'failed' }, 500);
  }
}

// Where the card is in a saved chat, or null (an incognito chat, or a reply not saved yet).
function cardOf(body) {
  const { conversationId, position } = body ?? {};
  return typeof conversationId === 'string' && CONVERSATION_ID.test(conversationId)
    && Number.isInteger(position) && position >= 0 && position < MAX_CHAT_MESSAGES ? { conversationId, position } : null;
}

// DELETE ?id=: deletes one of the signed-in user's memories.
export async function DELETE(request) {
  const user = await requireUser(request);
  if (!user.userId) return json({ error: user.error, code: user.reason }, user.status);
  if (!hasDatabase()) return json({ error: 'Memory is not set up yet.' }, 503);
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !MEMORY_ID.test(id)) return json({ error: 'Invalid memory.' }, 400);
  try {
    await deleteMemory(user.userId, id);
    return json({ ok: true });
  } catch (error) {
    console.error('memories DELETE failed', error?.code ?? error?.name);
    return json({ error: 'Could not delete the memory.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
