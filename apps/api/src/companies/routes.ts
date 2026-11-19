import { and, asc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { parseBody, requireUser } from '../auth/routes.ts';
import { findContact } from '../contacts/routes.ts';
import { companies, contactCompanies, contacts } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { requireEnabled } from '../modules/routes.ts';
import {
  parseId,
  type Database,
  type Transaction,
} from '../organizations/access.ts';
import { checkRecordVersion, recordPageSize, recordQuery } from '../records.ts';
import { websiteSchema } from '../website.ts';

const fields = z
  .object({
    name: z.string().trim().min(1).max(100),
    website: z
      .string()
      .trim()
      .pipe(websiteSchema)
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
const linkFields = z
  .object({
    version: z.number().int().positive(),
    companyId: z.uuid().nullable(),
  })
  .strict();

export async function findCompany(
  tx: Transaction,
  organizationId: string,
  id: string,
) {
  const [company] = await tx
    .select()
    .from(companies)
    .where(
      and(eq(companies.organizationId, organizationId), eq(companies.id, id)),
    );
  if (!company) throw new HttpError(404, 'NOT_FOUND', 'Company not found.');
  return company;
}

async function ensureUniqueName(
  tx: Transaction,
  organizationId: string,
  name: string,
  id?: string,
) {
  const [existing] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, organizationId),
        sql`lower(${companies.name}) = lower(${name})`,
        id ? ne(companies.id, id) : undefined,
      ),
    )
    .limit(1);
  if (existing)
    throw new HttpError(
      409,
      'COMPANY_NAME_IN_USE',
      'A company already uses this name, including archived companies.',
    );
}

export function createCompaniesRouter(db: Database) {
  const router = Router();
  const path = '/organizations/:organizationId/companies';
  const linkPath = '/organizations/:organizationId/contacts/:contactId/company';

  router.get(path, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const query = parseBody(recordQuery, req.query);
    const result = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'companies', 'read');
      const where = and(
        eq(companies.organizationId, organizationId),
        query.status === 'active'
          ? isNull(companies.archivedAt)
          : query.status === 'archived'
            ? isNotNull(companies.archivedAt)
            : undefined,
        query.q
          ? or(
              sql`position(lower(${query.q}) in lower(${companies.name})) > 0`,
              sql`position(lower(${query.q}) in lower(coalesce(${companies.website}, ''))) > 0`,
              sql`position(lower(${query.q}) in lower(coalesce(${companies.phone}, ''))) > 0`,
            )
          : undefined,
      );
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(companies)
        .where(where);
      const items = await tx
        .select()
        .from(companies)
        .where(where)
        .orderBy(asc(companies.name), asc(companies.id))
        .limit(recordPageSize)
        .offset((query.page - 1) * recordPageSize);
      return {
        companies: items,
        total: count.total,
        page: query.page,
        pageSize: recordPageSize,
      };
    });
    res.json(result);
  });

  router.get(`${path}/:companyId`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.companyId);
    const company = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'companies', 'read');
      return findCompany(tx, organizationId, id);
    });
    res.json({ company });
  });

  router.post(path, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const data = parseBody(fields, req.body);
    const company = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'companies', 'read');
      await ensureUniqueName(tx, organizationId, data.name);
      const [created] = await tx
        .insert(companies)
        .values({ ...data, organizationId })
        .returning();
      return created;
    });
    res.status(201).json({ company });
  });

  router.put(`${path}/:companyId`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.companyId);
    const { version, ...data } = parseBody(editFields, req.body);
    const company = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'companies', 'read');
      const current = await findCompany(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Company');
      await ensureUniqueName(tx, organizationId, data.name, id);
      const [updated] = await tx
        .update(companies)
        .set({ ...data, version: version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(companies.organizationId, organizationId),
            eq(companies.id, id),
          ),
        )
        .returning();
      return updated;
    });
    res.json({ company });
  });

  router.put(`${path}/:companyId/archive`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.companyId);
    const { version, archived } = parseBody(archiveFields, req.body);
    const company = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'companies', 'read');
      const current = await findCompany(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Company');
      if (Boolean(current.archivedAt) === archived) return current;
      const [updated] = await tx
        .update(companies)
        .set({
          archivedAt: archived ? new Date() : null,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(companies.organizationId, organizationId),
            eq(companies.id, id),
          ),
        )
        .returning();
      return updated;
    });
    res.json({ company });
  });

  router.get(linkPath, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const contactId = parseId(req.params.contactId);
    const company = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'contacts', 'read');
      await requireEnabled(tx, organizationId, user.id, 'companies', 'read');
      await findContact(tx, organizationId, contactId);
      const [linked] = await tx
        .select({ company: companies })
        .from(contactCompanies)
        .innerJoin(
          companies,
          and(
            eq(companies.organizationId, contactCompanies.organizationId),
            eq(companies.id, contactCompanies.companyId),
          ),
        )
        .where(
          and(
            eq(contactCompanies.organizationId, organizationId),
            eq(contactCompanies.contactId, contactId),
          ),
        );
      return linked?.company ?? null;
    });
    res.json({ company });
  });

  router.put(linkPath, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const contactId = parseId(req.params.contactId);
    const { companyId, version } = parseBody(linkFields, req.body);
    const result = await db.transaction(async (tx) => {
      await requireEnabled(tx, organizationId, user.id, 'contacts', 'read');
      await requireEnabled(tx, organizationId, user.id, 'companies', 'read');
      const contact = await findContact(tx, organizationId, contactId);
      checkRecordVersion(contact.version, version, 'Contact');
      const company = companyId
        ? await findCompany(tx, organizationId, companyId)
        : null;
      if (company?.archivedAt)
        throw new HttpError(
          409,
          'COMPANY_ARCHIVED',
          'Restore the company before linking it.',
        );
      if (companyId) {
        await tx
          .insert(contactCompanies)
          .values({ organizationId, contactId, companyId })
          .onConflictDoUpdate({
            target: [
              contactCompanies.organizationId,
              contactCompanies.contactId,
            ],
            set: { companyId },
          });
      } else {
        await tx
          .delete(contactCompanies)
          .where(
            and(
              eq(contactCompanies.organizationId, organizationId),
              eq(contactCompanies.contactId, contactId),
            ),
          );
      }
      const [updated] = await tx
        .update(contacts)
        .set({ version: version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(contacts.organizationId, organizationId),
            eq(contacts.id, contactId),
          ),
        )
        .returning();
      return { company, contact: updated };
    });
    res.json(result);
  });
  return router;
}
