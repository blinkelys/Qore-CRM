export async function up(pgm) {
  pgm.createTable(
    'module_entitlements',
    {
      organization_id: {
        type: 'uuid',
        notNull: true,
        references: 'organizations',
        onDelete: 'CASCADE',
      },
      module_key: { type: 'text', notNull: true },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    { constraints: { primaryKey: ['organization_id', 'module_key'] } },
  );
  pgm.createTable(
    'organization_modules',
    {
      organization_id: {
        type: 'uuid',
        notNull: true,
        references: 'organizations',
        onDelete: 'CASCADE',
      },
      module_key: { type: 'text', notNull: true },
      enabled: { type: 'boolean', notNull: true, default: false },
      settings: { type: 'jsonb', notNull: true },
      settings_version: { type: 'integer', notNull: true },
    },
    {
      constraints: {
        primaryKey: ['organization_id', 'module_key'],
        check: 'settings_version > 0',
      },
    },
  );
}

export async function down(pgm) {
  pgm.dropTable('organization_modules');
  pgm.dropTable('module_entitlements');
}
