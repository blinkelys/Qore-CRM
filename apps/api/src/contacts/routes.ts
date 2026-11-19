import { and, asc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { parseBody, requireUser } from '../auth/routes.ts';
import { contacts } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { requireEnabled } from '../modules/routes.ts';
import {
  parseId,
  type Database,
  type Transaction,
} from '../organizations/access.ts';
import { checkRecordVersion, recordPageSize, recordQuery } from '../records.ts';

const fields = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.union([z.literal(''), z.email().max(254)]))
      .transform((value) => value || null),
    phone: z
      .string()
      .trim()
      .max(40)
      .transform((value) => value || null),
  })
  .strict();
const editFields = fields.safeExtend({ version: z.number().int().positive() });
const archiveFields = z
  .object({ version: z.number().int().positive(), archived: z.boolean() })
  .strict();

export async function findContact(
  tx: Transaction,
  organizationId: string,
  id: string,
) {
  const [contact] = await tx
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.organizationId, organizationId), eq(contacts.id, id)),
    );
  if (!contact) throw new HttpError(404, 'NOT_FOUND', 'Contact not found.');
  return contact;
}

async function ensureUniqueEmail(
  tx: Transaction,
  organizationId: string,
  email: string | null,
  id?: string,
) {
  if (!email) return;
  const [existing] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, organizationId),
        sql`lower(${contacts.email}) = ${email}`,
        id ? ne(contacts.id, id) : undefined,
      ),
    )
    .limit(1);
  if (existing)
    throw new HttpError(
      409,
      'CONTACT_EMAIL_IN_USE',
      'A contact already uses this email, including archived contacts.',
    );
}

export function createContactsRouter(db: Database) {
  const router = Router();
  const path = '/organizations/:organizationId/contacts';

  // Module "read" grants CRM access; "manage" governs module configuration.
  router.get(path, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const query = parseBody(recordQuery, req.query);
    const result = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'contacts', 'read');
      const where = and(
        eq(contacts.organizationId, organizationId),
        query.status === 'active'
          ? isNull(contacts.archivedAt)
          : query.status === 'archived'
            ? isNotNull(contacts.archivedAt)
            : undefined,
        query.q
          ? or(
              sql`position(lower(${query.q}) in lower(${contacts.name})) > 0`,
              sql`position(lower(${query.q}) in lower(coalesce(${contacts.email}, ''))) > 0`,
              sql`position(lower(${query.q}) in lower(coalesce(${contacts.phone}, ''))) > 0`,
            )
          : undefined,
      );
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(contacts)
        .where(where);
      const items = await tx
        .select()
        .from(contacts)
        .where(where)
        .orderBy(asc(contacts.name), asc(contacts.id))
        .limit(recordPageSize)
        .offset((query.page - 1) * recordPageSize);
      return {
        contacts: items,
        total: count.total,
        page: query.page,
        pageSize: recordPageSize,
      };
    });
    res.json(result);
  });

  router.get(`${path}/:contactId`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.contactId);
    const contact = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'contacts', 'read');
      return findContact(tx, organizationId, id);
    });
    res.json({ contact });
  });

  router.post(path, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const data = parseBody(fields, req.body);
    const contact = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'contacts', 'read');
      await ensureUniqueEmail(tx, organizationId, data.email);
      const [created] = await tx
        .insert(contacts)
        .values({ ...data, organizationId })
        .returning();
      return created;
    });
    res.status(201).json({ contact });
  });

  router.put(`${path}/:contactId`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.contactId);
    const { version, ...data } = parseBody(editFields, req.body);
    const contact = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'contacts', 'read');
      const current = await findContact(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Contact');
      await ensureUniqueEmail(tx, organizationId, data.email, id);
      const [updated] = await tx
        .update(contacts)
        .set({ ...data, version: version + 1, updatedAt: new Date() })
        .where(
          and(eq(contacts.organizationId, organizationId), eq(contacts.id, id)),
        )
        .returning();
      return updated;
    });
    res.json({ contact });
  });

  router.put(`${path}/:contactId/archive`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.contactId);
    const { version, archived } = parseBody(archiveFields, req.body);
    const contact = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'contacts', 'read');
      const current = await findContact(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Contact');
      if (Boolean(current.archivedAt) === archived) return current;
      const [updated] = await tx
        .update(contacts)
        .set({
          archivedAt: archived ? new Date() : null,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(contacts.organizationId, organizationId), eq(contacts.id, id)),
        )
        .returning();
      return updated;
    });
    res.json({ contact });
  });
  return router;
}
