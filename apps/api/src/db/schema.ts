import { integer, pgTable, timestamp } from 'drizzle-orm/pg-core';

export const appMetadata = pgTable('app_metadata', {
  id: integer('id').primaryKey(),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull(),
});
