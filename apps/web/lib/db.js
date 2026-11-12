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
// Tools: the ones a user can turn off in Settings, by the name the model calls them.
// web_search, search_docs and get_status come from the MCP server; the others from the web app.
export const TOOL_OPTIONS = ['web_search', 'search_docs', 'search_chats', 'save_memory', 'get_status'];
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
  // Tools the user turned off in Settings, by name. Empty means every tool is on.
  `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS disabled_tools text[] NOT NULL DEFAULT '{}'`,
  // Set while a chat is shared with a public link. Deleting the chat removes the link with it.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS share_id text UNIQUE`,
  // Two-letter language of the chat, found from its first message and kept once set.
  `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS language text`,
  // A reply's "Save to memory" card: {"text": "...", "status": "pending" | "saved" | "declined"}.
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS memory jsonb`,
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
    `SELECT role, content, model, trace_id, attachments, memory FROM messages
     WHERE user_id = $1 AND conversation_id = $2 ORDER BY position`, [userId, conversationId]);
  return rows.map((r) => ({ role: r.role, content: r.content, model: r.model, traceId: r.trace_id, attachments: r.attachments ?? null, memory: r.memory ?? null }));
}

// Replaces the stored conversation with its current state, so edits and
// regenerations (which drop later messages) are saved too. An existing chat keeps
// its title unless replaceTitle is set (a new AI title for the first message).
// The language is kept once set.
export async function saveConversation(userId, conversationId, title, messages, { replaceTitle = false, language = null } = {}) {
  const d = await db();
  await d.transaction([
    [`INSERT INTO conversations (user_id, id, title, language) VALUES ($1, $2, $3, $5)
      ON CONFLICT (user_id, id) DO UPDATE SET updated_at = now(),
        title = CASE WHEN $4::boolean THEN EXCLUDED.title ELSE conversations.title END,
        language = COALESCE(conversations.language, EXCLUDED.language)`, [userId, conversationId, title, replaceTitle, language]],
    ['DELETE FROM messages WHERE user_id = $1 AND conversation_id = $2', [userId, conversationId]],
    [`INSERT INTO messages (user_id, conversation_id, position, role, content, model, trace_id, attachments, memory)
      SELECT $1, $2, p, r, c, m, t, a::jsonb, y::jsonb FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[]) AS x(p, r, c, m, t, a, y)`,
     [userId, conversationId, messages.map((_, i) => i), messages.map((m) => m.role), messages.map((m) => m.content),
      messages.map((m) => m.model ?? null), messages.map((m) => m.traceId ?? null),
      messages.map((m) => (m.attachments?.length ? JSON.stringify(m.attachments) : null)),
      messages.map((m) => (m.memory ? JSON.stringify(m.memory) : null))]],
  ]);
}

// Answers a reply's "Save to memory" card that is still waiting: "saved" (with the text that was
// saved, which may have been changed in the card) or "declined". A card already answered is left as it is.
export async function markMemory(userId, conversationId, position, status, text) {
  const d = await db();
  await d.query(
    `UPDATE messages SET memory = jsonb_build_object('text', COALESCE($5::text, memory->>'text'), 'status', $4::text)
     WHERE user_id = $1 AND conversation_id = $2 AND position = $3 AND role = 'assistant'
       AND memory IS NOT NULL AND memory->>'status' = 'pending'`,
    [userId, conversationId, position, status, text ?? null]);
}

// What is known about a chat so far; empty values if it isn't saved yet or can't be read.
// Chat search for the agent: the signed-in user's saved chats whose title or messages contain any
// of the words, except the chat in progress. Returns the matching rows, most recent chats first;
// ranking and snippets are made by the caller (@proxi/agent/chat-search).
export async function searchChatMessages(userId, patterns, excludeId) {
  if (!patterns.length) return [];
  const d = await db();
  const rows = await d.query(
    `SELECT c.id, c.title, c.updated_at, m.position, m.role, m.content
     FROM conversations c JOIN messages m ON m.user_id = c.user_id AND m.conversation_id = c.id
     WHERE c.user_id = $1 AND ($2::text IS NULL OR c.id <> $2)
       AND (m.content ILIKE ANY($3::text[]) OR c.title ILIKE ANY($3::text[]))
     ORDER BY c.updated_at DESC, m.position LIMIT 400`, [userId, excludeId ?? null, patterns]);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: new Date(r.updated_at).toISOString(), position: r.position, role: r.role, content: r.content }));
}

export async function conversationAttributes(userId, conversationId) {
  try {
    const d = await db();
    const [row] = await d.query('SELECT language FROM conversations WHERE user_id = $1 AND id = $2', [userId, conversationId]);
    return { language: row?.language ?? null };
  } catch {
    return { language: null };
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
  const rows = await d.query('SELECT chat_retention_days, custom_instructions, disabled_tools FROM user_settings WHERE user_id = $1', [userId]);
  return {
    chatRetentionDays: rows[0]?.chat_retention_days ?? DEFAULT_RETENTION_DAYS,
    customInstructions: rows[0]?.custom_instructions ?? '',
    disabledTools: rows[0]?.disabled_tools ?? [],
  };
}

// Saves the settings that are given and keeps the others as they are.
export async function saveSettings(userId, { chatRetentionDays, customInstructions, disabledTools }) {
  const d = await db();
  await d.query(
    `INSERT INTO user_settings (user_id, chat_retention_days, custom_instructions, disabled_tools)
     VALUES ($1, COALESCE($2::int, $4::int), COALESCE($3::text, ''), COALESCE($5::text[], '{}'))
     ON CONFLICT (user_id) DO UPDATE SET
       chat_retention_days = COALESCE($2::int, user_settings.chat_retention_days),
       custom_instructions = COALESCE($3::text, user_settings.custom_instructions),
       disabled_tools = COALESCE($5::text[], user_settings.disabled_tools),
       updated_at = now()`,
    [userId, chatRetentionDays ?? null, customInstructions ?? null, DEFAULT_RETENTION_DAYS, disabledTools ?? null]);
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

// Deletes all of the user's chats. Returns the monitoring trace IDs of their messages,
// so the caller can delete those too. Memories, settings and privacy counts are kept.
export async function deleteAllConversations(userId) {
  const d = await db();
  const rows = await d.query(
    `WITH traces AS (SELECT trace_id FROM messages WHERE user_id = $1 AND trace_id IS NOT NULL),
          gone AS (DELETE FROM conversations WHERE user_id = $1 RETURNING id)
     SELECT DISTINCT trace_id FROM traces`, [userId]);
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

// When a chat is due for automatic deletion: its last activity plus its owner's
// "Delete chats after" setting, the same rule deleteInactiveConversations uses.
// A shared link stops working at that moment, even if the daily cleanup hasn't run yet.
// $1 in the surrounding query must be the default number of days.
const EXPIRES_AT = `c.updated_at + make_interval(days => COALESCE(
  (SELECT s.chat_retention_days FROM user_settings s WHERE s.user_id = c.user_id), $1))`;

// The user's shared chats that haven't expired, most recently active first.
export async function listSharedConversations(userId, defaultDays = DEFAULT_RETENTION_DAYS) {
  const d = await db();
  const rows = await d.query(
    `SELECT id, title, share_id, expires_at FROM (
       SELECT c.id, c.title, c.share_id, c.updated_at, ${EXPIRES_AT} AS expires_at
       FROM conversations c WHERE c.user_id = $2 AND c.share_id IS NOT NULL) t
     WHERE expires_at > now() ORDER BY updated_at DESC, id`, [defaultDays, userId]);
  return rows.map((r) => ({ id: r.id, title: r.title, shareId: r.share_id, expiresAt: new Date(r.expires_at).toISOString() }));
}

// A shared chat as anyone with the link sees it: title, last activity and messages.
// Never includes who it belongs to. Returns null when the link doesn't exist or has expired.
export async function getSharedConversation(shareId, defaultDays = DEFAULT_RETENTION_DAYS) {
  const d = await db();
  const chats = await d.query(
    `SELECT c.user_id, c.id, c.title, c.updated_at FROM conversations c
     WHERE c.share_id = $2 AND ${EXPIRES_AT} > now()`, [defaultDays, shareId]);
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
