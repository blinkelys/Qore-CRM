import {
  integer,
  boolean,
  check,
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const appMetadata = pgTable('app_metadata', {
  id: integer('id').primaryKey(),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const passwordResets = pgTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

export const invitations = pgTable('invitations', {
  tokenHash: text('token_hash').primaryKey(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role', { enum: ['owner', 'admin', 'member'] }).notNull(),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const moduleEntitlements = pgTable(
  'module_entitlements',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.moduleKey] })],
);

export const organizationModules = pgTable(
  'organization_modules',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    settings: jsonb('settings').notNull(),
    settingsVersion: integer('settings_version').notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.moduleKey] })],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('contacts_organization_id_id_key').on(
      table.organizationId,
      table.id,
    ),
  ],
);

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    website: text('website'),
    phone: text('phone'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique('companies_uniq_organization_id_id').on(
      table.organizationId,
      table.id,
    ),
  ],
);

export const contactCompanies = pgTable(
  'contact_companies',
  {
    organizationId: uuid('organization_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    companyId: uuid('company_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.contactId] }),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }).onDelete('cascade'),
  ],
);

export const timelineEntries = pgTable(
  'timeline_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id'),
    companyId: uuid('company_id'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', {
      enum: ['note', 'call', 'meeting', 'email', 'task'],
    }).notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }).onDelete('cascade'),
    check(
      'timeline_entries_target_check',
      sql`(${table.contactId} IS NOT NULL) <> (${table.companyId} IS NOT NULL)`,
    ),
    check(
      'timeline_entries_kind_check',
      sql`${table.kind} IN ('note', 'call', 'meeting', 'email', 'task')`,
    ),
    check(
      'timeline_entries_body_check',
      sql`length(trim(${table.body})) BETWEEN 1 AND 4000`,
    ),
  ],
);
