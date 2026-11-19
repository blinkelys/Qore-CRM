import { and, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { parseBody, requireUser } from '../auth/routes.ts';
import { findCompany } from '../companies/routes.ts';
import { findContact } from '../contacts/routes.ts';
import { timelineEntries, users } from '../db/schema.ts';
import { requireEnabled } from '../modules/routes.ts';
import {
  parseId,
  type Database,
  type Transaction,
} from '../organizations/access.ts';
import { recordPageSize } from '../records.ts';

const entryFields = z
  .object({
    kind: z.enum(['note', 'call', 'meeting', 'email', 'task']),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();
const queryFields = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
type RecordType = 'contacts' | 'companies';

async function requireRecord(
  tx: Transaction,
  organizationId: string,
  userId: string,
  recordType: RecordType,
  recordId: string,
) {
  await requireEnabled(tx, organizationId, userId, 'timeline', 'read');
  await requireEnabled(tx, organizationId, userId, recordType, 'read');
  if (recordType === 'contacts')
    await findContact(tx, organizationId, recordId);
  else await findCompany(tx, organizationId, recordId);
}

export function createTimelineRouter(db: Database) {
  const router = Router();
  for (const recordType of ['contacts', 'companies'] as const) {
    const path = `/organizations/:organizationId/${recordType}/:recordId/timeline`;
    router.get(path, async (req, res) => {
      const user = await requireUser(db, req);
      const organizationId = parseId(req.params.organizationId);
      const recordId = parseId(req.params.recordId);
      const { page } = parseBody(queryFields, req.query);
      const result = await db.transaction(async (tx) => {
        await requireRecord(tx, organizationId, user.id, recordType, recordId);
        const where = and(
          eq(timelineEntries.organizationId, organizationId),
          eq(
            recordType === 'contacts'
              ? timelineEntries.contactId
              : timelineEntries.companyId,
            recordId,
          ),
        );
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(timelineEntries)
          .where(where);
        const entries = await tx
          .select({
            id: timelineEntries.id,
            kind: timelineEntries.kind,
            body: timelineEntries.body,
            createdAt: timelineEntries.createdAt,
            author: { id: users.id, email: users.email },
          })
          .from(timelineEntries)
          .innerJoin(users, eq(timelineEntries.authorId, users.id))
          .where(where)
          .orderBy(desc(timelineEntries.createdAt), desc(timelineEntries.id))
          .limit(recordPageSize)
          .offset((page - 1) * recordPageSize);
        return { entries, total: count.total, page, pageSize: recordPageSize };
      });
      res.json(result);
    });

    router.post(path, async (req, res) => {
      const user = await requireUser(db, req);
      const organizationId = parseId(req.params.organizationId);
      const recordId = parseId(req.params.recordId);
      const data = parseBody(entryFields, req.body);
      const entry = await db.transaction(async (tx) => {
        await requireRecord(tx, organizationId, user.id, recordType, recordId);
        const [created] = await tx
          .insert(timelineEntries)
          .values({
            organizationId,
            contactId: recordType === 'contacts' ? recordId : null,
            companyId: recordType === 'companies' ? recordId : null,
            authorId: user.id,
            ...data,
          })
          .returning({
            id: timelineEntries.id,
            kind: timelineEntries.kind,
            body: timelineEntries.body,
            createdAt: timelineEntries.createdAt,
          });
        return { ...created, author: user };
      });
      res.status(201).json({ entry });
    });
  }
  return router;
}
