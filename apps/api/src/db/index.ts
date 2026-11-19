import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000 });
  const db = drizzle(pool, { schema });

  return {
    db,
    async checkHealth() {
      const rows = await db
        .select()
        .from(schema.appMetadata)
        .where(eq(schema.appMetadata.id, 1));
      if (rows.length !== 1) throw new Error('Database is not initialized');
    },
    close: () => pool.end(),
  };
}
