import { neon } from '@neondatabase/serverless';

// Chat history in Postgres (Neon). Every query is scoped by the signed-in
// user's Clerk ID, and that ID is part of each primary key, so one user can
// never read or overwrite another user's chats.

export const CONVERSATION_ID = /^[\w-]{1,64}$/;

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
    'SELECT id, title, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200', [userId]);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: new Date(r.updated_at).toISOString() }));
}

export async function getMessages(userId, conversationId) {
  const d = await db();
  const rows = await d.query(
    `SELECT role, content, model, trace_id, attachments FROM messages
     WHERE user_id = $1 AND conversation_id = $2 ORDER BY position`, [userId, conversationId]);
  return rows.map((r) => ({ role: r.role, content: r.content, model: r.model, traceId: r.trace_id, attachments: r.attachments ?? null }));
}

// Replaces the stored conversation with its current state, so edits and
// regenerations (which drop later messages) are saved too. An existing chat keeps
// its title unless replaceTitle is set (a new AI title for the first message).
export async function saveConversation(userId, conversationId, title, messages, { replaceTitle = false } = {}) {
  const d = await db();
  await d.transaction([
    [`INSERT INTO conversations (user_id, id, title) VALUES ($1, $2, $3)
      ON CONFLICT (user_id, id) DO UPDATE SET updated_at = now(),
        title = CASE WHEN $4::boolean THEN EXCLUDED.title ELSE conversations.title END`, [userId, conversationId, title, replaceTitle]],
    ['DELETE FROM messages WHERE user_id = $1 AND conversation_id = $2', [userId, conversationId]],
    [`INSERT INTO messages (user_id, conversation_id, position, role, content, model, trace_id, attachments)
      SELECT $1, $2, p, r, c, m, t, a::jsonb FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS x(p, r, c, m, t, a)`,
     [userId, conversationId, messages.map((_, i) => i), messages.map((m) => m.role), messages.map((m) => m.content),
      messages.map((m) => m.model ?? null), messages.map((m) => m.traceId ?? null),
      messages.map((m) => (m.attachments?.length ? JSON.stringify(m.attachments) : null))]],
  ]);
}

// Retention: removes every chat with no activity for the given number of days.
// Their messages go with them (ON DELETE CASCADE). Returns how many were removed.
export async function deleteInactiveConversations(days) {
  const d = await db();
  const rows = await d.query(
    `DELETE FROM conversations WHERE updated_at < now() - make_interval(days => $1) RETURNING id`, [days]);
  return rows.length;
}

export async function deleteConversation(userId, conversationId) {
  const d = await db();
  await d.query('DELETE FROM conversations WHERE user_id = $1 AND id = $2', [userId, conversationId]);
}
