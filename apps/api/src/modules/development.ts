import { sql } from 'drizzle-orm';
import type { Database } from '../organizations/access.ts';
import { moduleDefinitions } from './registry.ts';

export function developmentEntitlements(organizationIds: readonly string[]) {
  return organizationIds.flatMap((organizationId) =>
    moduleDefinitions.map((definition) => ({
      organizationId,
      moduleKey: definition.key,
    })),
  );
}

export async function seedDevelopmentEntitlements(
  db: Pick<Database, 'execute'>,
) {
  for (const definition of moduleDefinitions) {
    await db.execute(sql`
      INSERT INTO module_entitlements (organization_id, module_key)
      SELECT id, ${definition.key} FROM organizations
      ON CONFLICT DO NOTHING
    `);
  }
}
