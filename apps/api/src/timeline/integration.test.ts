import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createAuthRouter } from '../auth/routes.ts';
import { createCompaniesRouter } from '../companies/routes.ts';
import { loadConfig } from '../config.ts';
import { createContactsRouter } from '../contacts/routes.ts';
import { createDatabase } from '../db/index.ts';
import {
  memberships,
  organizations,
  timelineEntries,
  users,
} from '../db/schema.ts';
import { setEntitlement } from '../modules/entitlements.ts';
import { createModuleRouter } from '../modules/routes.ts';
import { createOrganizationRouter } from '../organizations/routes.ts';
import { createTimelineRouter } from './routes.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'http://localhost:8080';
const emails = ['owner', 'member', 'outsider'].map(
  (name) => `${name}-${randomUUID()}@example.test`,
);
const logger = pino({ level: 'silent' });

describe.skipIf(!databaseUrl)('notes and activities with PostgreSQL', () => {
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
    .use(createCompaniesRouter(database.db))
    .use(createTimelineRouter(database.db));
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

  it('records attributed history without crossing tenant or module boundaries', async () => {
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
    for (const org of orgIds) {
      for (const key of ['contacts', 'companies', 'timeline']) {
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
    const contact = await owner
      .post(`/api/organizations/${first}/contacts`)
      .set('Origin', origin)
      .send({ name: 'Ada', email: '', phone: '' });
    const otherContact = await owner
      .post(`/api/organizations/${second}/contacts`)
      .set('Origin', origin)
      .send({ name: 'Other', email: '', phone: '' });
    const company = await owner
      .post(`/api/organizations/${first}/companies`)
      .set('Origin', origin)
      .send({ name: 'Acme', website: '', phone: '' });
    expect([contact.status, otherContact.status, company.status]).toEqual([
      201, 201, 201,
    ]);
    const contactId: string = contact.body.contact.id;
    const otherContactId: string = otherContact.body.contact.id;
    const companyId: string = company.body.company.id;
    const contactPath = `/api/organizations/${first}/contacts/${contactId}/timeline`;
    const companyPath = `/api/organizations/${first}/companies/${companyId}/timeline`;
    const foreignPath = `/api/organizations/${second}/contacts/${contactId}/timeline`;
    expect((await outsider.get(contactPath)).status).toBe(404);
    expect(
      (
        await outsider
          .post(contactPath)
          .set('Origin', origin)
          .send({ kind: 'note', body: 'No' })
      ).status,
    ).toBe(404);
    expect((await owner.get(foreignPath)).status).toBe(404);
    expect(
      (
        await owner
          .post(foreignPath)
          .set('Origin', origin)
          .send({ kind: 'note', body: 'No' })
      ).status,
    ).toBe(404);
    expect(
      (
        await owner
          .post(contactPath)
          .set('Origin', origin)
          .send({ kind: 'note', body: '  ' })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner
          .post(contactPath)
          .set('Origin', origin)
          .send({ kind: 'other', body: 'Invalid' })
      ).status,
    ).toBe(400);
    expect(
      (
        await owner
          .post(contactPath)
          .set('Origin', origin)
          .send({ kind: 'note', body: 'x'.repeat(4001) })
      ).status,
    ).toBe(400);
    const created = await member
      .post(contactPath)
      .set('Origin', origin)
      .send({ kind: 'note', body: '  First note  ' });
    expect(created.status).toBe(201);
    expect(created.body.entry).toMatchObject({
      kind: 'note',
      body: 'First note',
      author: { id: userIds[1], email: emails[1] },
    });
    expect(created.body.entry.createdAt).toBeTruthy();
    const call = await owner
      .post(companyPath)
      .set('Origin', origin)
      .send({ kind: 'call', body: 'Discussed contract' });
    expect(call.status).toBe(201);
    expect((await owner.get(companyPath)).body.entries).toHaveLength(1);
    expect((await owner.get(contactPath)).body.entries).toHaveLength(1);
    expect((await owner.get(contactPath).query({ page: 0 })).status).toBe(400);
    await expect(
      database.db.insert(timelineEntries).values({
        organizationId: first,
        contactId: otherContactId,
        authorId: userIds[0],
        kind: 'note',
        body: 'wrong tenant',
      }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(timelineEntries).values({
        organizationId: first,
        contactId,
        companyId,
        authorId: userIds[0],
        kind: 'note',
        body: 'two targets',
      }),
    ).rejects.toThrow();
    await database.db.insert(timelineEntries).values(
      Array.from({ length: 20 }, (_, i) => ({
        organizationId: first,
        contactId,
        authorId: userIds[0],
        kind: 'meeting' as const,
        body: `Meeting ${i}`,
      })),
    );
    const page = await owner.get(contactPath).query({ page: 2 });
    expect(page.body).toMatchObject({ total: 21, page: 2, pageSize: 20 });
    expect(page.body.entries).toHaveLength(1);
    await owner
      .put(`/api/organizations/${first}/contacts/${contactId}/archive`)
      .set('Origin', origin)
      .send({ archived: true, version: 1 });
    expect((await owner.get(contactPath)).body.total).toBe(21);
    expect(
      (
        await owner
          .post(contactPath)
          .set('Origin', origin)
          .send({ kind: 'task', body: 'Follow up' })
      ).status,
    ).toBe(201);
    await database.db
      .delete(memberships)
      .where(
        and(
          eq(memberships.organizationId, first),
          eq(memberships.userId, userIds[1]),
        ),
      );
    expect((await member.get(contactPath)).status).toBe(404);
    const history = await owner.get(contactPath).query({ page: 2 });
    expect(
      history.body.entries.some(
        (entry: { author: { id: string } }) => entry.author.id === userIds[1],
      ),
    ).toBe(true);
    await owner
      .put(`/api/organizations/${first}/modules/timeline/enabled`)
      .set('Origin', origin)
      .send({ enabled: false });
    expect((await owner.get(contactPath)).status).toBe(404);
    expect(
      (
        await owner
          .post(companyPath)
          .set('Origin', origin)
          .send({ kind: 'note', body: 'No' })
      ).status,
    ).toBe(404);
    await owner
      .put(`/api/organizations/${first}/modules/timeline/enabled`)
      .set('Origin', origin)
      .send({ enabled: true });
    await owner
      .put(`/api/organizations/${first}/modules/contacts/enabled`)
      .set('Origin', origin)
      .send({ enabled: false });
    expect((await owner.get(contactPath)).status).toBe(404);
    expect((await owner.get(companyPath)).body.total).toBe(1);
    await owner
      .put(`/api/organizations/${first}/modules/contacts/enabled`)
      .set('Origin', origin)
      .send({ enabled: true });
    await setEntitlement(database.db, first, 'timeline', 'revoke');
    expect((await owner.get(contactPath)).status).toBe(404);
    await setEntitlement(database.db, first, 'timeline', 'grant');
    expect((await owner.get(contactPath)).body.total).toBe(22);
  });
});
