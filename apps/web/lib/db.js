import { neon } from '@neondatabase/serverless';

// Chat history in Postgres (Neon). Every query is scoped by the signed-in
// user's Clerk ID, and that ID is part of each primary key, so one user can
// never read or overwrite another user's chats.

export const CONVERSATION_ID = /^[\w-]{1,64}$/;
// Public link IDs: 16 random bytes in base64url, unrelated to the chat's own ID.
export const SHARE_ID = /^[\w-]{22}$/;

// "Delete chats after": the choices in Settings, and the default for users who never chose.
export const RETENTION_OPTIONS = [7, 30, 90];
export const DEFAULT_RETENTION_DAYS = 30;
// Custom instructions: how long they may be, in characters.
export const CUSTOM_INSTRUCTIONS_MAX = 1500;
// Memory: how many facts one user can have saved.
export const MEMORY_LIMIT = 50;

let driver = null;
let ready = null;

// Tests swap in a local Postgres with the same two methods.
export function setDriver(d) { driver = d; ready = null; }

function getDriver() {
  if (driver) return driver;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  const sql = neon(url);
  driver = {
    query: (text, params) => sql.query(text, params),
    transaction: (steps) => sql.transaction(steps.map(([text, params]) => sql.query(text, params))),
  };
  return driver;
}

export function hasDatabase() { return !!getDriver(); }

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS conversations (
     user_id text NOT NULL,
     id text NOT NULL,
     title text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, id))`,
  `CREATE INDEX IF NOT EXISTS conversations_recent ON conversations (user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS conversations_inactive ON conversations (updated_at)`,
  `CREATE TABLE IF NOT EXISTS messages (
     user_id text NOT NULL,
     conversation_id text NOT NULL,
     position int NOT NULL,
     role text NOT NULL CHECK (role IN ('user', 'assistant')),
     content text NOT NULL,
     model text,
     trace_id text,
     PRIMARY KEY (user_id, conversation_id, position),
     FOREIGN KEY (user_id, conversation_id) REFERENCES conversations (user_id, id) ON DELETE CASCADE)`,
  // Only the kinds of files that were attached, e.g. [{"kind":"image"}]. The files and their names are never stored.
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments jsonb`,
  `CREATE TABLE IF NOT EXISTS user_settings (
     user_id text PRIMARY KEY,
     chat_retention_days int NOT NULL CHECK (chat_retention_days IN (7, 30, 90)),
     updated_at timestamptz NOT NULL DEFAULT now())`,
  `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS custom_instructions text NOT NULL DEFAULT ''`,
  // Set while a chat is shared with a public link. Deleting the chat removes the link with it.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS share_id text UNIQUE`,
  // Two-letter language of the chat, found from its first message and kept once set.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS language text`,
  // A reply's "Message Lisandro" card: {"summary": "...", "sent": true}, or "skipped": true after
  // "Not now". The address typed in the card is never stored.
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS contact jsonb`,
  // True once any message in the chat asked for a person.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false`,
  // Facts the user asked Proxi to remember, already redacted. Kept until the user deletes them.
  `CREATE TABLE IF NOT EXISTS memories (
     user_id text NOT NULL,
     id text NOT NULL,
     content text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, id))`,
  // Privacy page: how many details of each type were redacted from the user's messages, per day.
  // Only counts: never the details themselves, and no link to a chat.
  `CREATE TABLE IF NOT EXISTS redaction_counts (
     user_id text NOT NULL,
     day date NOT NULL,
     type text NOT NULL,
     count int NOT NULL CHECK (count > 0),
     PRIMARY KEY (user_id, day, type))`,
];

async function db() {
  const d = getDriver();
  if (!d) throw new Error('Database is not configured');
  ready ??= (async () => { for (const stmt of SCHEMA) await d.query(stmt, []); })().catch((e) => { ready = null; throw e; });
  await ready;
  return d;
}

export async function listConversations(userId) {
  const d = await db();
  const rows = await d.query(
    'SELECT id, title, updated_at, share_id FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200', [userId]);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: new Date(r.updated_at).toISOString(), shareId: r.share_id ?? null }));
}

export async function getMessages(userId, conversationId) {
  const d = await db();
  const rows = await d.query(
    `SELECT role, content, model, trace_id, attachments, contact FROM messages
     WHERE user_id = $1 AND conversation_id = $2 ORDER BY position`, [userId, conversationId]);
  return rows.map((r) => ({ role: r.role, content: r.content, model: r.model, traceId: r.trace_id, attachments: r.attachments ?? null, contact: r.contact ?? null }));
}

// Replaces the stored conversation with its current state, so edits and
// regenerations (which drop later messages) are saved too. An existing chat keeps
// its title unless replaceTitle is set (a new AI title for the first message).
// The language is kept once set; escalated stays true once it has been true.
export async function saveConversation(userId, conversationId, title, messages, { replaceTitle = false, language = null, escalated = false } = {}) {
  const d = await db();
  await d.transaction([
    [`INSERT INTO conversations (user_id, id, title, language, escalated) VALUES ($1, $2, $3, $5, $6)
      ON CONFLICT (user_id, id) DO UPDATE SET updated_at = now(),
        title = CASE WHEN $4::boolean THEN EXCLUDED.title ELSE conversations.title END,
        language = COALESCE(conversations.language, EXCLUDED.language),
        escalated = conversations.escalated OR EXCLUDED.escalated`, [userId, conversationId, title, replaceTitle, language, escalated]],
    ['DELETE FROM messages WHERE user_id = $1 AND conversation_id = $2', [userId, conversationId]],
    [`INSERT INTO messages (user_id, conversation_id, position, role, content, model, trace_id, attachments, contact)
      SELECT $1, $2, p, r, c, m, t, a::jsonb, k::jsonb FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) AS x(p, r, c, m, t, a, k)`,
     [userId, conversationId, messages.map((_, i) => i), messages.map((m) => m.role), messages.map((m) => m.content),
      messages.map((m) => m.model ?? null), messages.map((m) => m.traceId ?? null),
      messages.map((m) => (m.attachments?.length ? JSON.stringify(m.attachments) : null)),
      messages.map((m) => (m.contact ? JSON.stringify(m.contact) : null))]],
  ]);
}

// Marks a reply's "Message Lisandro" card as sent, so it shows as sent when the chat is opened again.
export async function markContactSent(userId, conversationId, position) {
  const d = await db();
  await d.query(
    `UPDATE messages SET contact = jsonb_set(contact, '{sent}', 'true'::jsonb)
     WHERE user_id = $1 AND conversation_id = $2 AND position = $3 AND role = 'assistant' AND contact IS NOT NULL`,
    [userId, conversationId, position]);
}

// Marks a reply's "Message Lisandro" card as skipped ("Not now"), so it stays a short note when the
// chat is opened again. A card that was sent stays sent.
export async function markContactSkipped(userId, conversationId, position) {
  const d = await db();
  await d.query(
    `UPDATE messages SET contact = jsonb_set(contact, '{skipped}', 'true'::jsonb)
     WHERE user_id = $1 AND conversation_id = $2 AND position = $3 AND role = 'assistant' AND contact IS NOT NULL
       AND NOT COALESCE((contact->>'sent')::boolean, false)`,
    [userId, conversationId, position]);
}

// What is known about a chat so far; empty values if it isn't saved yet or can't be read.
export async function conversationAttributes(userId, conversationId) {
  try {
    const d = await db();
    const [row] = await d.query('SELECT language, escalated FROM conversations WHERE user_id = $1 AND id = $2', [userId, conversationId]);
    return { language: row?.language ?? null, escalated: row?.escalated ?? false };
  } catch {
    return { language: null, escalated: false };
  }
}

// Retention: removes every chat with no activity for longer than its owner's
// "Delete chats after" setting (or the default). Their messages go with them
// (ON DELETE CASCADE). Returns how many were removed and the monitoring trace IDs
// of their messages, so the caller can delete those too.
export async function deleteInactiveConversations(defaultDays = DEFAULT_RETENTION_DAYS) {
  const d = await db();
  const [row] = await d.query(
    `WITH due AS (
       SELECT c.user_id, c.id FROM conversations c
       WHERE c.updated_at < now() - make_interval(days => COALESCE(
         (SELECT s.chat_retention_days FROM user_settings s WHERE s.user_id = c.user_id), $1))),
     traces AS (
       SELECT m.trace_id FROM messages m JOIN due ON m.user_id = due.user_id AND m.conversation_id = due.id
       WHERE m.trace_id IS NOT NULL),
     gone AS (
       DELETE FROM conversations c USING due WHERE c.user_id = due.user_id AND c.id = due.id RETURNING c.id)
     SELECT (SELECT count(*) FROM gone)::int AS deleted, (SELECT array_agg(DISTINCT trace_id) FROM traces) AS trace_ids`, [defaultDays]);
  return { deleted: Number(row?.deleted ?? 0), traceIds: row?.trace_ids ?? [] };
}

export async function getSettings(userId) {
  const d = await db();
  const rows = await d.query('SELECT chat_retention_days, custom_instructions FROM user_settings WHERE user_id = $1', [userId]);
  return {
    chatRetentionDays: rows[0]?.chat_retention_days ?? DEFAULT_RETENTION_DAYS,
    customInstructions: rows[0]?.custom_instructions ?? '',
  };
}

// Saves the settings that are given and keeps the others as they are.
export async function saveSettings(userId, { chatRetentionDays, customInstructions }) {
  const d = await db();
  await d.query(
    `INSERT INTO user_settings (user_id, chat_retention_days, custom_instructions)
     VALUES ($1, COALESCE($2::int, $4::int), COALESCE($3::text, ''))
     ON CONFLICT (user_id) DO UPDATE SET
       chat_retention_days = COALESCE($2::int, user_settings.chat_retention_days),
       custom_instructions = COALESCE($3::text, user_settings.custom_instructions),
       updated_at = now()`,
    [userId, chatRetentionDays ?? null, customInstructions ?? null, DEFAULT_RETENTION_DAYS]);
}

// Which of these chat IDs still belong to a saved chat, for any user.
export async function existingConversationIds(ids) {
  if (!ids.length) return [];
  const d = await db();
  const rows = await d.query('SELECT DISTINCT id FROM conversations WHERE id = ANY($1::text[])', [ids]);
  return rows.map((r) => r.id);
}

// Deletes one chat. Returns the monitoring trace IDs of its messages, so the caller can delete those too.
export async function deleteConversation(userId, conversationId) {
  const d = await db();
  const rows = await d.query(
    `WITH traces AS (SELECT trace_id FROM messages WHERE user_id = $1 AND conversation_id = $2 AND trace_id IS NOT NULL),
          gone AS (DELETE FROM conversations WHERE user_id = $1 AND id = $2 RETURNING id)
     SELECT DISTINCT trace_id FROM traces WHERE EXISTS (SELECT 1 FROM gone)`, [userId, conversationId]);
  return rows.map((r) => r.trace_id);
}

// Account deletion: removes everything stored for the user. Returns the monitoring trace IDs
// of their messages, so the caller can delete those too.
export async function deleteAccountData(userId) {
  const d = await db();
  const rows = await d.query('SELECT DISTINCT trace_id FROM messages WHERE user_id = $1 AND trace_id IS NOT NULL', [userId]);
  await d.transaction([
    ['DELETE FROM conversations WHERE user_id = $1', [userId]],
    ['DELETE FROM memories WHERE user_id = $1', [userId]],
    ['DELETE FROM user_settings WHERE user_id = $1', [userId]],
    ['DELETE FROM redaction_counts WHERE user_id = $1', [userId]],
  ]);
  return rows.map((r) => r.trace_id);
}

// Shares one of the user's chats. Sharing again keeps the existing link. Returns
// the link ID, or null when the chat doesn't exist (yet).
export async function shareConversation(userId, conversationId, newShareId) {
  const d = await db();
  const rows = await d.query(
    `UPDATE conversations SET share_id = COALESCE(share_id, $3) WHERE user_id = $1 AND id = $2 RETURNING share_id`,
    [userId, conversationId, newShareId]);
  return rows[0]?.share_id ?? null;
}

export async function unshareConversation(userId, conversationId) {
  const d = await db();
  await d.query('UPDATE conversations SET share_id = NULL WHERE user_id = $1 AND id = $2', [userId, conversationId]);
}

// A shared chat as anyone with the link sees it: title, last activity and messages.
// Never includes who it belongs to. Returns null when the link doesn't exist.
export async function getSharedConversation(shareId) {
  const d = await db();
  const chats = await d.query('SELECT user_id, id, title, updated_at FROM conversations WHERE share_id = $1', [shareId]);
  if (!chats.length) return null;
  const { user_id: userId, id, title, updated_at: updatedAt } = chats[0];
  const rows = await d.query(
    `SELECT role, content, attachments FROM messages
     WHERE user_id = $1 AND conversation_id = $2 ORDER BY position`, [userId, id]);
  return {
    title,
    updatedAt: new Date(updatedAt).toISOString(),
    messages: rows.map((r) => ({ role: r.role, content: r.content, attachments: r.attachments ?? null })),
  };
}

// The user's saved memories, oldest first.
export async function listMemories(userId) {
  const d = await db();
  const rows = await d.query('SELECT id, content, created_at FROM memories WHERE user_id = $1 ORDER BY created_at, id', [userId]);
  return rows.map((r) => ({ id: r.id, content: r.content, createdAt: new Date(r.created_at).toISOString() }));
}

// Saves a memory unless the same text is already saved or the user has MEMORY_LIMIT of them.
// Returns "saved", "duplicate" or "full".
export async function addMemory(userId, id, content) {
  const d = await db();
  const rows = await d.query(
    `INSERT INTO memories (user_id, id, content)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM memories WHERE user_id = $1 AND content = $3)
       AND (SELECT count(*) FROM memories WHERE user_id = $1) < $4
     RETURNING id`, [userId, id, content, MEMORY_LIMIT]);
  if (rows.length) return 'saved';
  const same = await d.query('SELECT 1 FROM memories WHERE user_id = $1 AND content = $2', [userId, content]);
  return same.length ? 'duplicate' : 'full';
}

export async function deleteMemory(userId, id) {
  const d = await db();
  await d.query('DELETE FROM memories WHERE user_id = $1 AND id = $2', [userId, id]);
}

// Adds what was redacted from a message to today's counts. A message the chat already has
// saved at that position, with the same text, was counted before (a regenerated reply), so
// it is skipped.
export async function recordRedactions(userId, counts, { conversationId, position, content }) {
  const entries = Object.entries(counts || {}).filter(([, n]) => Number.isInteger(n) && n > 0);
  if (!entries.length) return;
  const d = await db();
  await d.query(
    `INSERT INTO redaction_counts (user_id, day, type, count)
     SELECT $1, current_date, t, n FROM unnest($2::text[], $3::int[]) AS x(t, n)
     WHERE NOT EXISTS (SELECT 1 FROM messages
       WHERE user_id = $1 AND conversation_id = $4 AND position = $5 AND role = 'user' AND content = $6)
     ON CONFLICT (user_id, day, type) DO UPDATE SET count = redaction_counts.count + EXCLUDED.count`,
    [userId, entries.map(([t]) => t), entries.map(([, n]) => n), conversationId, position, content]);
}

// The user's redaction counts: per day this month, per month before that, and the first day counted.
export async function getRedactionCounts(userId) {
  const d = await db();
  const rows = await d.query(
    `SELECT to_char(CASE WHEN day >= date_trunc('month', current_date) THEN day ELSE date_trunc('month', day)::date END, 'YYYY-MM-DD') AS day,
            type, sum(count)::int AS count
     FROM redaction_counts WHERE user_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [userId]);
  const [first] = await d.query(`SELECT to_char(min(day), 'YYYY-MM-DD') AS day FROM redaction_counts WHERE user_id = $1`, [userId]);
  const [today] = await d.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS day`, []);
  return { rows, since: first?.day ?? null, today: today.day };
}
