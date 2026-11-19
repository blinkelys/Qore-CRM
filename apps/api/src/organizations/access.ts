import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { createDatabase } from '../db/index.ts';
import { memberships, organizations } from '../db/schema.ts';
import { HttpError } from '../http.ts';

export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function parseId(value: unknown) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success)
    throw new HttpError(400, 'INVALID_INPUT', 'Invalid identifier.');
  return parsed.data;
}

export async function lockOrganization(
  tx: Transaction,
  organizationId: string,
) {
  const [organization] = await tx
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for('update');
  if (!organization)
    throw new HttpError(404, 'NOT_FOUND', 'Organization not found.');
  return organization;
}

export async function membership(
  tx: Transaction,
  organizationId: string,
  userId: string,
) {
  const [member] = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
      ),
    );
  return member;
}
