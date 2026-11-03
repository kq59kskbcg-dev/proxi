// The schema list db.js ran on every cold start before migrations were tracked, copied as it
// was. Production databases were created by it, so migration 1 must upgrade them cleanly.
export const SCHEMA = [
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
];
