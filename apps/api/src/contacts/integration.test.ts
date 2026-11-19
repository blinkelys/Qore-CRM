import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { Router } from 'express';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createAuthRouter } from '../auth/routes.ts';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/index.ts';
import { contacts, memberships, organizations, users } from '../db/schema.ts';
import { setEntitlement } from '../modules/entitlements.ts';
import { createModuleRouter } from '../modules/routes.ts';
import { createOrganizationRouter } from '../organizations/routes.ts';
import { createContactsRouter } from './routes.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'http://localhost:8080';
const emails = ['owner', 'member', 'outsider'].map(
  (name) => `${name}-${randomUUID()}@example.test`,
);
const logger = pino({ level: 'silent' });

describe.skipIf(!databaseUrl)('contacts with PostgreSQL', () => {
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
  const router = Router()
    .use(createAuthRouter(database.db, config, { async send() {} }, logger))
    .use(
      createOrganizationRouter(
        database.db,
        config,
        { async send() {} },
        logger,
      ),
    )
    .use(createModuleRouter(database.db))
    .use(createContactsRouter(database.db));
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

  it('scopes and protects contact lifecycle, search and conflicting changes', async () => {
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
    const base = `/api/organizations/${first}/contacts`;
    const other = `/api/organizations/${second}/contacts`;
    expect((await owner.get(base)).status).toBe(404);
    for (const organization of orgIds) {
      expect(
        (
          await owner
            .put(`/api/organizations/${organization}/modules/contacts/enabled`)
            .set('Origin', origin)
            .send({ enabled: true })
        ).status,
      ).toBe(204);
    }
    expect((await outsider.get(base)).status).toBe(404);
    const created = await member.post(base).set('Origin', origin).send({
      name: ' Ada Lovelace ',
      email: ' ADA@EXAMPLE.TEST ',
      phone: '123',
    });
    expect(created.status).toBe(201);
    expect(created.body.contact).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      version: 1,
    });
    const id = created.body.contact.id;
    expect((await owner.get(`${other}/${id}`)).status).toBe(404);
    expect(
      (
        await owner
          .put(`${other}/${id}`)
          .set('Origin', origin)
          .send({ name: 'Wrong', email: '', phone: '', version: 1 })
      ).status,
    ).toBe(404);
    expect(
      (
        await member
          .post(base)
          .set('Origin', origin)
          .send({ name: 'Duplicate', email: 'ADA@example.test', phone: '' })
      ).body.error.code,
    ).toBe('CONTACT_EMAIL_IN_USE');
    expect(
      (
        await owner
          .post(other)
          .set('Origin', origin)
          .send({ name: 'Other', email: 'ada@example.test', phone: '' })
      ).status,
    ).toBe(201);
    const updated = await member
      .put(`${base}/${id}`)
      .set('Origin', origin)
      .send({
        name: 'Ada Byron',
        email: 'ada@example.test',
        phone: '',
        version: 1,
      });
    expect(updated.body.contact.version).toBe(2);
    expect(
      (
        await owner
          .put(`${base}/${id}`)
          .set('Origin', origin)
          .send({ name: 'Stale', email: '', phone: '', version: 1 })
      ).body.error.code,
    ).toBe('CONTACT_CONFLICT');
    expect((await owner.get(base).query({ q: 'BYRON' })).body.total).toBe(1);
    expect((await owner.get(base).query({ q: '%' })).body.total).toBe(0);
    expect((await owner.get(base).query({ page: 0 })).status).toBe(400);
    const archived = await member
      .put(`${base}/${id}/archive`)
      .set('Origin', origin)
      .send({ version: 2, archived: true });
    expect(archived.body.contact.archivedAt).toBeTruthy();
    expect((await owner.get(base)).body.total).toBe(0);
    expect(
      (await owner.get(base).query({ status: 'archived' })).body.total,
    ).toBe(1);
    expect(
      (
        await owner
          .post(base)
          .set('Origin', origin)
          .send({ name: 'Duplicate', email: 'ada@example.test', phone: '' })
      ).status,
    ).toBe(409);
    expect(
      (
        await owner
          .put(`${base}/${id}/archive`)
          .set('Origin', origin)
          .send({ version: 3, archived: false })
      ).body.contact.version,
    ).toBe(4);
    await database.db.insert(contacts).values(
      Array.from({ length: 20 }, (_, i) => ({
        organizationId: first,
        name: `Contact ${String(i).padStart(2, '0')}`,
      })),
    );
    const page = await owner.get(base).query({ page: 2 });
    expect(page.body).toMatchObject({ total: 21, page: 2, pageSize: 20 });
    expect(page.body.contacts).toHaveLength(1);
    await owner
      .put(`/api/organizations/${first}/modules/contacts/enabled`)
      .set('Origin', origin)
      .send({ enabled: false });
    expect((await member.get(`${base}/${id}`)).status).toBe(404);
    expect(
      (
        await member
          .post(base)
          .set('Origin', origin)
          .send({ name: 'Blocked', email: '', phone: '' })
      ).status,
    ).toBe(404);
    await owner
      .put(`/api/organizations/${first}/modules/contacts/enabled`)
      .set('Origin', origin)
      .send({ enabled: true });
    expect((await member.get(`${base}/${id}`)).body.contact.name).toBe(
      'Ada Byron',
    );
    await setEntitlement(database.db, first, 'contacts', 'revoke');
    expect((await member.get(base)).status).toBe(404);
    await setEntitlement(database.db, first, 'contacts', 'grant');
    expect((await member.get(`${base}/${id}`)).body.contact.name).toBe(
      'Ada Byron',
    );
  });
});
