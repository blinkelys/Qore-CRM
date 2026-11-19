export async function up(pgm) {
  pgm.createTable('timeline_entries', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations',
      onDelete: 'CASCADE',
    },
    contact_id: { type: 'uuid' },
    company_id: { type: 'uuid' },
    author_id: { type: 'uuid', notNull: true, references: 'users' },
    kind: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.sql(
    'ALTER TABLE timeline_entries ADD CONSTRAINT timeline_entries_target_check CHECK ((contact_id IS NOT NULL) <> (company_id IS NOT NULL))',
  );
  pgm.sql(
    "ALTER TABLE timeline_entries ADD CONSTRAINT timeline_entries_kind_check CHECK (kind IN ('note', 'call', 'meeting', 'email', 'task'))",
  );
  pgm.sql(
    'ALTER TABLE timeline_entries ADD CONSTRAINT timeline_entries_body_check CHECK (length(trim(body)) BETWEEN 1 AND 4000)',
  );
  pgm.sql(
    'ALTER TABLE timeline_entries ADD CONSTRAINT timeline_entries_contact_fk FOREIGN KEY (organization_id, contact_id) REFERENCES contacts (organization_id, id) ON DELETE CASCADE',
  );
  pgm.sql(
    'ALTER TABLE timeline_entries ADD CONSTRAINT timeline_entries_company_fk FOREIGN KEY (organization_id, company_id) REFERENCES companies (organization_id, id) ON DELETE CASCADE',
  );
  pgm.sql(
    'CREATE INDEX timeline_contact_idx ON timeline_entries (organization_id, contact_id, created_at DESC, id DESC) WHERE contact_id IS NOT NULL',
  );
  pgm.sql(
    'CREATE INDEX timeline_company_idx ON timeline_entries (organization_id, company_id, created_at DESC, id DESC) WHERE company_id IS NOT NULL',
  );
}

export async function down(pgm) {
  pgm.dropTable('timeline_entries');
}
