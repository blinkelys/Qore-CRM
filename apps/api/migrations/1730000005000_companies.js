export async function up(pgm) {
  pgm.addConstraint('contacts', 'contacts_organization_id_id_key', {
    unique: ['organization_id', 'id'],
  });
  pgm.createTable(
    'companies',
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
      website: { type: 'text' },
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
    {
      constraints: { check: 'version > 0', unique: ['organization_id', 'id'] },
    },
  );
  pgm.sql(
    'CREATE UNIQUE INDEX companies_org_name_unique ON companies (organization_id, lower(name))',
  );
  pgm.createIndex('companies', ['organization_id', 'name', 'id']);
  pgm.createTable(
    'contact_companies',
    {
      organization_id: { type: 'uuid', notNull: true },
      contact_id: { type: 'uuid', notNull: true },
      company_id: { type: 'uuid', notNull: true },
    },
    { constraints: { primaryKey: ['organization_id', 'contact_id'] } },
  );
  pgm.sql(
    'ALTER TABLE contact_companies ADD CONSTRAINT contact_companies_contact_fk FOREIGN KEY (organization_id, contact_id) REFERENCES contacts (organization_id, id) ON DELETE CASCADE',
  );
  pgm.sql(
    'ALTER TABLE contact_companies ADD CONSTRAINT contact_companies_company_fk FOREIGN KEY (organization_id, company_id) REFERENCES companies (organization_id, id) ON DELETE CASCADE',
  );
  pgm.createIndex('contact_companies', ['organization_id', 'company_id']);
}

export async function down(pgm) {
  pgm.dropTable('contact_companies');
  pgm.dropTable('companies');
  pgm.dropConstraint('contacts', 'contacts_organization_id_id_key');
}
