export async function up(pgm) {
  pgm.createTable('app_metadata', {
    id: { type: 'integer', primaryKey: true },
    installed_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.addConstraint('app_metadata', 'app_metadata_singleton', 'CHECK (id = 1)');
  pgm.sql('INSERT INTO app_metadata (id) VALUES (1)');
}

export async function down(pgm) {
  pgm.dropTable('app_metadata');
}
