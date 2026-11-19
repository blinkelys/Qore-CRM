export async function up(pgm) {
  pgm.createTable(
    'contacts',
    {
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
      name: { type: 'text', notNull: true },
      email: { type: 'text' },
      phone: { type: 'text' },
      archived_at: { type: 'timestamptz' },
      version: { type: 'integer', notNull: true, default: 1 },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
      updated_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    { constraints: { check: 'version > 0' } },
  );
  pgm.sql(
    'CREATE UNIQUE INDEX contacts_org_email_unique ON contacts (organization_id, lower(email)) WHERE email IS NOT NULL',
  );
  pgm.createIndex('contacts', ['organization_id', 'name', 'id']);
}

export async function down(pgm) {
  pgm.dropTable('contacts');
}
