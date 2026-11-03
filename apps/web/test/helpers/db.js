import { PGlite } from '@electric-sql/pglite';
import { setDriver } from '../../lib/db.js';

// A fresh in-memory Postgres as the app's database. Returns the PGlite instance.
export function useTestDatabase(pg = new PGlite()) {
  setDriver({
    query: async (text, params) => (await pg.query(text, params)).rows,
    transaction: (steps) => pg.transaction(async (tx) => {
      for (const [text, params] of steps) await tx.query(text, params);
    }),
  });
  return pg;
}
