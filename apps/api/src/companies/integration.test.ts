import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { Router } from 'express';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createAuthRouter } from '../auth/routes.ts';
import { loadConfig } from '../config.ts';
import { createContactsRouter } from '../contacts/routes.ts';
import { createDatabase } from '../db/index.ts';
import {
  companies,
  contactCompanies,
  memberships,
  organizations,
  users,
} from '../db/schema.ts';
import { setEntitlement } from '../modules/entitlements.ts';
import { createModuleRouter } from '../modules/routes.ts';
import { createOrganizationRouter } from '../organizations/routes.ts';
import { createCompaniesRouter } from './routes.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'http://localhost:8080';
const emails = ['owner', 'member', 'outsider'].map(
  (name) => `${name}-${randomUUID()}@example.test`,
);
const logger = pino({ level: 'silent' });

describe.skipIf(!databaseUrl)('companies with PostgreSQL', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl ?? 'postgres://localhost/qore',
    APP_ORIGIN: origin,
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    MAIL_FROM: 'noreply@example.test',
    SEED_DEVELOPMENT_ENTITLEMENTS: 'true',
  });
  const database = createDatabase(config.DATABASE_URL, logger);
  const mailer = { async send() {} };
  const router = Router()
    .use(createAuthRouter(database.db, config, mailer, logger))
    .use(createOrganizationRouter(database.db, config, mailer, logger))
    .use(createModuleRouter(database.db))
    .use(createContactsRouter(database.db))
    .use(createCompaniesRouter(database.db));
  const app = createApp(logger, database.checkHealth, {
    router,
    origin,
    trustProxy: false,
  });
  const [owner, member, outsider] = [
    request.agent(app),
    request.agent(app),
    request.agent(app),
  ];
  const orgIds: string[] = [];

  beforeAll(async () => database.checkHealth());
  afterAll(async () => {
    await database.db
      .delete(organizations)
      .where(inArray(organizations.id, orgIds));
    await database.db.delete(users).where(inArray(users.email, emails));
    await database.close();
  });

  it('isolates companies and preserves tenant-safe links across lifecycle changes', async () => {
    const userIds: string[] = [];
    for (const [index, agent] of [owner, member, outsider].entries()) {
      const response = await agent
        .post('/api/auth/register')
        .set('Origin', origin)
        .send({ email: emails[index], password: 'a secure password 123' });
      expect(response.status).toBe(201);
      userIds.push(response.body.user.id);
    }
    for (const name of ['First', 'Second']) {
      const response = await owner
        .post('/api/organizations')
        .set('Origin', origin)
        .send({ name });
      expect(response.status).toBe(201);
      orgIds.push(response.body.organization.id);
    }
    const [first, second] = orgIds;
    await database.db
      .insert(memberships)
      .values({ organizationId: first, userId: userIds[1], role: 'member' });
    const base = `/api/organizations/${first}/companies`;
    const other = `/api/organizations/${second}/companies`;
    expect((await owner.get(base)).status).toBe(404);
    for (const org of orgIds) {
      for (const key of ['contacts', 'companies']) {
        expect(
          (
            await owner
              .put(`/api/organizations/${org}/modules/${key}/enabled`)
              .set('Origin', origin)
              .send({ enabled: true })
          ).status,
        ).toBe(204);
      }
    }
    expect((await outsider.get(base)).status).toBe(404);
    const company = await member
      .post(base)
      .set('Origin', origin)
      .send({ name: ' Acme ', website: 'https://acme.test', phone: '' });
    expect(company.status).toBe(201);
    const companyId: string = company.body.company.id;
    expect(company.body.company).toMatchObject({ name: 'Acme', version: 1 });
    expect(
      (
        await owner
          .post(base)
          .set('Origin', origin)
          .send({ name: 'acME', website: '', phone: '' })
      ).body.error.code,
    ).toBe('COMPANY_NAME_IN_USE');
    expect(
      (
        await owner
          .post(base)
          .set('Origin', origin)
          .send({ name: 'Invalid', website: 'javascript:alert(1)', phone: '' })
      ).status,
    ).toBe(400);
    const otherCompany = await owner
      .post(other)
      .set('Origin', origin)
      .send({ name: 'Acme', website: '', phone: '' });
    expect(otherCompany.status).toBe(201);
    expect((await owner.get(`${other}/${companyId}`)).status).toBe(404);
    const contact = await member
      .post(`/api/organizations/${first}/contacts`)
      .set('Origin', origin)
      .send({ name: 'Ada', email: '', phone: '' });
    const otherContact = await owner
      .post(`/api/organizations/${second}/contacts`)
      .set('Origin', origin)
      .send({ name: 'Other', email: '', phone: '' });
    expect(contact.status).toBe(201);
    expect(otherContact.status).toBe(201);
    const contactId: string = contact.body.contact.id;
    const link = `/api/organizations/${first}/contacts/${contactId}/company`;
    expect((await outsider.get(link)).status).toBe(404);
    expect(
      (
        await owner
          .put(link)
          .set('Origin', origin)
          .send({ companyId: otherCompany.body.company.id, version: 1 })
      ).status,
    ).toBe(404);
    await expect(
      database.db.insert(contactCompanies).values({
        organizationId: first,
        contactId,
        companyId: otherCompany.body.company.id,
      }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(contactCompanies).values({
        organizationId: first,
        contactId: otherContact.body.contact.id,
        companyId,
      }),
    ).rejects.toThrow();
    const linked = await member
      .put(link)
      .set('Origin', origin)
      .send({ companyId, version: 1 });
    expect(linked.body).toMatchObject({
      company: { id: companyId },
      contact: { version: 2 },
    });
    expect((await member.get(link)).body.company.id).toBe(companyId);
    expect(
      (
        await member
          .put(link)
          .set('Origin', origin)
          .send({ companyId: null, version: 1 })
      ).body.error.code,
    ).toBe('CONTACT_CONFLICT');
    const updated = await member
      .put(`${base}/${companyId}`)
      .set('Origin', origin)
      .send({ name: 'Acme Ltd', website: '', phone: '123', version: 1 });
    expect(updated.body.company.version).toBe(2);
    expect(
      (
        await owner
          .put(`${base}/${companyId}`)
          .set('Origin', origin)
          .send({ name: 'Stale', website: '', phone: '', version: 1 })
      ).body.error.code,
    ).toBe('COMPANY_CONFLICT');
    expect((await owner.get(base).query({ q: 'LTD' })).body.total).toBe(1);
    const archived = await member
      .put(`${base}/${companyId}/archive`)
      .set('Origin', origin)
      .send({ version: 2, archived: true });
    expect(archived.body.company.archivedAt).toBeTruthy();
    expect((await member.get(link)).body.company.archivedAt).toBeTruthy();
    expect(
      (
        await member
          .put(link)
          .set('Origin', origin)
          .send({ companyId, version: 2 })
      ).body.error.code,
    ).toBe('COMPANY_ARCHIVED');
    expect((await owner.get(base)).body.total).toBe(0);
    expect(
      (await owner.get(base).query({ status: 'archived' })).body.total,
    ).toBe(1);
    expect(
      (
        await owner
          .post(base)
          .set('Origin', origin)
          .send({ name: 'ACME LTD', website: '', phone: '' })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner
          .put(`${base}/${companyId}/archive`)
          .set('Origin', origin)
          .send({ version: 3, archived: false })
      ).body.company.version,
    ).toBe(4);
    await database.db.insert(companies).values(
      Array.from({ length: 20 }, (_, i) => ({
        organizationId: first,
        name: `Company ${String(i).padStart(2, '0')}`,
      })),
    );
    const page = await owner.get(base).query({ page: 2 });
    expect(page.body).toMatchObject({ total: 21, page: 2, pageSize: 20 });
    expect(page.body.companies).toHaveLength(1);
    await owner
      .put(`/api/organizations/${first}/modules/companies/enabled`)
      .set('Origin', origin)
      .send({ enabled: false });
    expect((await member.get(link)).status).toBe(404);
    expect(
      (await member.get(`/api/organizations/${first}/contacts/${contactId}`))
        .status,
    ).toBe(200);
    await owner
      .put(`/api/organizations/${first}/modules/companies/enabled`)
      .set('Origin', origin)
      .send({ enabled: true });
    expect((await member.get(link)).body.company.id).toBe(companyId);
    await owner
      .put(`/api/organizations/${first}/modules/contacts/enabled`)
      .set('Origin', origin)
      .send({ enabled: false });
    expect((await member.get(link)).status).toBe(404);
    expect((await member.get(`${base}/${companyId}`)).status).toBe(200);
    await owner
      .put(`/api/organizations/${first}/modules/contacts/enabled`)
      .set('Origin', origin)
      .send({ enabled: true });
    await setEntitlement(database.db, first, 'companies', 'revoke');
    expect((await member.get(link)).status).toBe(404);
    await setEntitlement(database.db, first, 'companies', 'grant');
    expect((await member.get(link)).body.company.id).toBe(companyId);
    const unlinked = await member
      .put(link)
      .set('Origin', origin)
      .send({ companyId: null, version: 2 });
    expect(unlinked.body).toMatchObject({
      company: null,
      contact: { version: 3 },
    });
    expect((await member.get(link)).body.company).toBeNull();
  });
});
