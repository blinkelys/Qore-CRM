export async function up(pgm) {
  pgm.createTable('pipeline_stages', {
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
    position: { type: 'integer', notNull: true },
    archived_at: { type: 'timestamptz' },
    version: { type: 'integer', notNull: true, default: 1 },
  });
  pgm.addConstraint('pipeline_stages', 'pipeline_stages_org_id_key', {
    unique: ['organization_id', 'id'],
  });
  pgm.sql(
    'ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_position_check CHECK (position >= 0)',
  );
  pgm.sql(
    'ALTER TABLE pipeline_stages ADD CONSTRAINT pipeline_stages_version_check CHECK (version > 0)',
  );
  pgm.sql(
    'CREATE UNIQUE INDEX pipeline_stages_org_name_unique ON pipeline_stages (organization_id, lower(name))',
  );
  pgm.createIndex('pipeline_stages', ['organization_id', 'position', 'id']);
  pgm.createTable('opportunities', {
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
    stage_id: { type: 'uuid', notNull: true },
    name: { type: 'text', notNull: true },
    amount: { type: 'numeric(14,2)' },
    currency: { type: 'text' },
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
  });
  pgm.sql(
    'ALTER TABLE opportunities ADD CONSTRAINT opportunities_stage_fk FOREIGN KEY (organization_id, stage_id) REFERENCES pipeline_stages (organization_id, id)',
  );
  pgm.sql(
    'ALTER TABLE opportunities ADD CONSTRAINT opportunities_version_check CHECK (version > 0)',
  );
  pgm.sql(
    "ALTER TABLE opportunities ADD CONSTRAINT opportunities_amount_check CHECK ((amount IS NULL AND currency IS NULL) OR (amount IS NOT NULL AND amount >= 0 AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$'))",
  );
  pgm.createIndex('opportunities', [
    'organization_id',
    'stage_id',
    'name',
    'id',
  ]);
}

export async function down(pgm) {
  pgm.dropTable('opportunities');
  pgm.dropTable('pipeline_stages');
}
