import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS, LATEST_VERSION, migrate, applyMigration, currentVersion } from '../lib/migrations.js';
import { setDriver, getSettings, listConversations, getMessages, saveSettings, RETENTION_OPTIONS, DEFAULT_RETENTION_DAYS } from '../lib/db.js';
import { SCHEMA as OLD_SCHEMA } from './fixtures/old-schema.js';

function driverFor(pg, seen = []) {
  return {
    query: async (text, params) => { seen.push(text); return (await pg.query(text, params)).rows; },
    transaction: (steps) => pg.transaction(async (tx) => {
      for (const [text, params] of steps) { seen.push(text); await tx.query(text, params); }
    }),
  };
}

// Everything that describes the schema: columns, constraints and indexes.
async function describe(pg) {
  const columns = (await pg.query(`SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'schema_migrations'
    ORDER BY table_name, column_name`)).rows;
  const constraints = (await pg.query(`SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> 'schema_migrations'
    ORDER BY 1, 2`)).rows;
  const indexes = (await pg.query(`SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1, 2`)).rows;
  return { columns, constraints, indexes };
}

async function dump(pg) {
  const out = {};
  for (const table of ['conversations', 'messages', 'user_settings', 'memories', 'redaction_counts']) {
    out[table] = (await pg.query(`SELECT * FROM ${table} ORDER BY 1, 2, 3`)).rows;
  }
  return out;
}

test('versions are numbered 1, 2, 3... in order', () => {
  assert.deepEqual(MIGRATIONS.map((m) => m.version), MIGRATIONS.map((_, i) => i + 1));
  assert.equal(LATEST_VERSION, MIGRATIONS.length);
});

test('migration 1 is exactly the schema the app used to create on every cold start', () => {
  const flat = (list) => list.map((stmt) => stmt.replace(/\s+/g, ' '));
  assert.deepEqual(flat(MIGRATIONS[0].statements), flat(OLD_SCHEMA));
});

test('a fresh database gets the whole schema and its history', async () => {
  const pg = new PGlite();
  const d = driverFor(pg);
  assert.equal(await currentVersion(d), 0);
  assert.deepEqual(await migrate(d), MIGRATIONS.map((m) => m.version));
  assert.equal(await currentVersion(d), LATEST_VERSION);
  const history = (await pg.query('SELECT version, name FROM schema_migrations ORDER BY version')).rows;
  assert.deepEqual(history, MIGRATIONS.map(({ version, name }) => ({ version, name })));
  // Running again changes nothing.
  assert.deepEqual(await migrate(d), []);
});

test('a database created by the old schema list upgrades with no change to its data or schema', async () => {
  const old = new PGlite();
  for (const stmt of OLD_SCHEMA) await old.query(stmt);
  await old.query(`INSERT INTO conversations (user_id, id, title, share_id, language, escalated) VALUES
    ('user_a', 'c1', 'Lisbon', 'AAAAAAAAAAAAAAAAAAAAAA', 'pt', true), ('user_b', 'c2', 'Rome', NULL, NULL, false)`);
  await old.query(`INSERT INTO messages (user_id, conversation_id, position, role, content, model, trace_id, attachments) VALUES
    ('user_a', 'c1', 0, 'user', 'Plan a trip', NULL, NULL, '[{"kind":"pdf"}]'),
    ('user_a', 'c1', 1, 'assistant', 'Day 1', 'claude-haiku-5-5', 't1', NULL)`);
  await old.query(`INSERT INTO user_settings (user_id, chat_retention_days, custom_instructions) VALUES ('user_a', 7, 'Be brief')`);
  await old.query(`INSERT INTO memories (user_id, id, content) VALUES ('user_a', 'm1', 'Likes trains')`);
  await old.query(`INSERT INTO redaction_counts (user_id, day, type, count) VALUES ('user_a', '2026-10-01', 'email', 2)`);
  const before = { schema: await describe(old), data: await dump(old) };

  const d = driverFor(old);
  assert.deepEqual(await migrate(d), MIGRATIONS.map((m) => m.version));
  assert.deepEqual(await describe(old), before.schema);
  assert.deepEqual(await dump(old), before.data);

  // And it matches a database built from migrations alone.
  const fresh = new PGlite();
  await migrate(driverFor(fresh));
  assert.deepEqual(await describe(fresh), before.schema);
});

test('a cold start on a current database runs one query before the first real one', async () => {
  const pg = new PGlite();
  await migrate(driverFor(pg));
  const seen = [];
  setDriver(driverFor(pg, seen));
  await listConversations('user_a');
  assert.equal(seen.length, 2);
  assert.match(seen[0], /FROM schema_migrations/);
  // Later queries don't check again.
  await getMessages('user_a', 'c1');
  assert.equal(seen.length, 3);
});

test('db() upgrades an old database on its first query', async () => {
  const pg = new PGlite();
  for (const stmt of OLD_SCHEMA) await pg.query(stmt);
  await pg.query(`INSERT INTO user_settings (user_id, chat_retention_days) VALUES ('user_a', 90)`);
  setDriver(driverFor(pg));
  assert.equal((await getSettings('user_a')).chatRetentionDays, 90);
  assert.equal(await currentVersion(driverFor(pg)), LATEST_VERSION);
});

test('a migration another instance already applied is skipped, not run twice', async () => {
  const pg = new PGlite();
  const d = driverFor(pg);
  await migrate(d);
  const marker = { version: LATEST_VERSION, name: 'again', statements: ['CREATE TABLE should_not_exist (x int)'] };
  assert.equal(await applyMigration(d, marker), false);
  assert.equal((await pg.query(`SELECT to_regclass('should_not_exist') AS t`)).rows[0].t, null);
});

test('a failing migration leaves nothing behind', async () => {
  const pg = new PGlite();
  const d = driverFor(pg);
  await migrate(d);
  const broken = { version: LATEST_VERSION + 1, name: 'broken', statements: ['CREATE TABLE half_done (x int)', 'SELECT * FROM no_such_table'] };
  await assert.rejects(migrate(d, [...MIGRATIONS, broken]), { code: '42P01' });
  assert.equal(await currentVersion(d), LATEST_VERSION);
  assert.equal((await pg.query(`SELECT to_regclass('half_done') AS t`)).rows[0].t, null);
});

test('the retention CHECK constraint allows exactly RETENTION_OPTIONS', async () => {
  const pg = new PGlite();
  await migrate(driverFor(pg));
  const [{ def }] = (await pg.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'user_settings'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%chat_retention_days%'`)).rows;
  const allowed = [...def.matchAll(/\d+/g)].map(Number).sort((a, b) => a - b);
  assert.deepEqual(allowed, [...RETENTION_OPTIONS].sort((a, b) => a - b),
    'RETENTION_OPTIONS changed: add a migration that changes the user_settings CHECK constraint');
  assert.ok(RETENTION_OPTIONS.includes(DEFAULT_RETENTION_DAYS));
});

test('saveSettings refuses a retention period that is not an option', async () => {
  setDriver(driverFor(new PGlite()));
  await assert.rejects(saveSettings('user_a', { chatRetentionDays: 14 }), RangeError);
});
