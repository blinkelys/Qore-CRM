export async function up(pgm) {
  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.createTable('sessions', {
    token_hash: { type: 'text', primaryKey: true },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('sessions', 'user_id');
  pgm.createTable('password_resets', {
    token_hash: { type: 'text', primaryKey: true },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('password_resets', 'user_id');
}

export async function down(pgm) {
  pgm.dropTable('password_resets');
  pgm.dropTable('sessions');
  pgm.dropTable('users');
}
