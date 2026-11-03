// Database schema changes, applied in order, each once. Each is recorded in schema_migrations
// with its version, so a cold start only has to read the latest version to know the schema is
// current. Never edit a migration that has shipped: add a new one with the next version.
//
// Postgres runs DDL inside transactions, so a migration applies completely or not at all.

export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial schema',
    // The schema as it was before migrations were tracked. Every statement is IF NOT EXISTS, so on
    // a database that already has it, this only records version 1.
    statements: [
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
    ],
  },
  {
    version: 2,
    name: 'rate limits',
    // Shared rate limits: the times of each key's allowed requests in the last window (at most
    // the limit's count), and whether the latest request was allowed. Keys are a user ID or a
    // hashed IP address, with a route prefix. Rows idle for longer than the window are deleted
    // by later requests, or by the daily cleanup.
    statements: [
      `CREATE TABLE rate_limits (
         key text PRIMARY KEY,
         hits timestamptz[] NOT NULL,
         allowed boolean NOT NULL,
         updated_at timestamptz NOT NULL)`,
      `CREATE INDEX rate_limits_idle ON rate_limits (updated_at)`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// Any fixed number works; it only has to be the same for every instance of the app.
const LOCK_KEY = 7265480101;

const CREATE_HISTORY = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version int PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now())`;

// The latest version applied, or 0 on a database that has never been migrated.
export async function currentVersion(d) {
  try {
    const [row] = await d.query('SELECT max(version) AS version FROM schema_migrations', []);
    return Number(row?.version ?? 0);
  } catch (error) {
    if (error?.code === '42P01') return 0; // no schema_migrations table yet
    throw error;
  }
}

// Applies one migration in a transaction. Instances that start together wait on the advisory
// lock; the version is recorded first, so the one that comes second fails on the primary key
// before running any statement, and nothing is applied twice. Returns false if another
// instance applied it first.
export async function applyMigration(d, migration) {
  try {
    await d.transaction([
      ['SELECT pg_advisory_xact_lock($1::bigint)', [LOCK_KEY]],
      [CREATE_HISTORY, []],
      ['INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]],
      ...migration.statements.map((stmt) => [stmt, []]),
    ]);
    return true;
  } catch (error) {
    // A duplicate version (or a serialization failure) means another instance got there first.
    if (await currentVersion(d).catch(() => 0) >= migration.version) return false;
    throw error;
  }
}

// Brings the database up to date. Returns the versions this call applied.
export async function migrate(d, migrations = MIGRATIONS) {
  const current = await currentVersion(d);
  const applied = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    if (await applyMigration(d, migration)) applied.push(migration.version);
  }
  return applied;
}
