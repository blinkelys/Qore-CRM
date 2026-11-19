import { and, eq } from 'drizzle-orm';
import { moduleEntitlements } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import {
  lockOrganization,
  parseId,
  type Database,
} from '../organizations/access.ts';
import { moduleRegistry } from './registry.ts';

export async function setEntitlement(
  db: Database,
  organizationId: string,
  moduleKey: string,
  action: 'grant' | 'revoke',
) {
  const id = parseId(organizationId);
  if (!moduleRegistry.has(moduleKey)) {
    throw new HttpError(400, 'INVALID_INPUT', 'Unknown module.');
  }
  await db.transaction(async (tx) => {
    await lockOrganization(tx, id);
    if (action === 'grant') {
      await tx
        .insert(moduleEntitlements)
        .values({ organizationId: id, moduleKey })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(moduleEntitlements)
        .where(
          and(
            eq(moduleEntitlements.organizationId, id),
            eq(moduleEntitlements.moduleKey, moduleKey),
          ),
        );
    }
  });
}
