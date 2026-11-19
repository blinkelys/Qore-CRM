export async function up(pgm) {
  pgm.createTable('organizations', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    name: { type: 'text', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.createTable(
    'memberships',
    {
      organization_id: {
        type: 'uuid',
        notNull: true,
        references: 'organizations',
        onDelete: 'CASCADE',
      },
      user_id: {
        type: 'uuid',
        notNull: true,
        references: 'users',
        onDelete: 'CASCADE',
      },
      role: { type: 'text', notNull: true },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('now()'),
      },
    },
    {
      constraints: {
        primaryKey: ['organization_id', 'user_id'],
        check: "role IN ('owner', 'admin', 'member')",
      },
    },
  );
  pgm.createIndex('memberships', 'user_id');
  pgm.createTable(
    'invitations',
    {
      token_hash: { type: 'text', primaryKey: true },
      organization_id: {
        type: 'uuid',
        notNull: true,
        references: 'organizations',
        onDelete: 'CASCADE',
      },
      email: { type: 'text', notNull: true },
      role: { type: 'text', notNull: true },
      invited_by: { type: 'uuid', notNull: true, references: 'users' },
      expires_at: { type: 'timestamptz', notNull: true },
    },
    { constraints: { check: "role IN ('owner', 'admin', 'member')" } },
  );
  pgm.createIndex('invitations', 'organization_id');
}

export async function down(pgm) {
  pgm.dropTable('invitations');
  pgm.dropTable('memberships');
  pgm.dropTable('organizations');
}
