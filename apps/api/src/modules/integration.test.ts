import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { createAuthRouter } from '../auth/routes.ts';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/index.ts';
import {
  memberships,
  moduleEntitlements,
  organizationModules,
  organizations,
  users,
} from '../db/schema.ts';
import { createOrganizationRouter } from '../organizations/routes.ts';
import { seedDevelopmentEntitlements } from './development.ts';
import { createModuleRouter } from './routes.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'http://localhost:8080';
const emails = ['owner', 'member', 'outsider'].map(
  (name) => `${name}-${randomUUID()}@example.test`,
);
const key = 'organization-profile';
const logger = pino({ level: 'silent' });

describe.skipIf(!databaseUrl)('module lifecycle with PostgreSQL', () => {
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
    .use(createModuleRouter(database.db));
  const app = createApp(logger, database.checkHealth, {
    router,
    origin,
    trustProxy: false,
  });
  const owner = request.agent(app);
  const member = request.agent(app);
  const outsider = request.agent(app);
  const orgIds: string[] = [];

  beforeAll(async () => database.checkHealth());
  afterAll(async () => {
    await database.db
      .delete(organizations)
      .where(inArray(organizations.id, orgIds));
    await database.db.delete(users).where(inArray(users.email, emails));
    await database.close();
  });

  it('enforces entitlements, roles, isolation and retained settings', async () => {
    const agents = [owner, member, outsider];
    const userIds: string[] = [];
    for (let index = 0; index < agents.length; index++) {
      const response = await agents[index]
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
    const route = `/api/organizations/${first}/modules/${key}`;
    expect(
      (await owner.get(`/api/organizations/${first}/modules`)).body.modules[0]
        .status,
    ).toBe('available');
    expect((await owner.get(`${route}/settings`)).status).toBe(404);
    expect(
      (await outsider.get(`/api/organizations/${first}/modules`)).status,
    ).toBe(404);
    expect(
      (
        await member
          .put(`${route}/enabled`)
          .set('Origin', origin)
          .send({ enabled: true })
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .put(`/api/organizations/${first}/entitlements`)
          .set('Origin', origin)
          .send({})
      ).status,
    ).toBe(404);

    await database.db
      .delete(moduleEntitlements)
      .where(
        and(
          eq(moduleEntitlements.organizationId, second),
          eq(moduleEntitlements.moduleKey, key),
        ),
      );
    const secondRoute = `/api/organizations/${second}/modules/${key}`;
    expect(
      (await owner.get(`/api/organizations/${second}/modules`)).body.modules[0]
        .status,
    ).toBe('unavailable');
    expect(
      (
        await owner
          .put(`${secondRoute}/enabled`)
          .set('Origin', origin)
          .send({ enabled: true })
      ).status,
    ).toBe(404);
    expect(
      (
        await owner
          .put(`${route}/enabled`)
          .set('Origin', origin)
          .send({ enabled: true })
      ).status,
    ).toBe(204);
    expect(
      (await owner.get(`/api/organizations/${first}/modules`)).body.modules[0]
        .status,
    ).toBe('enabled');
    const settings = {
      description: 'Our organization',
      website: 'https://example.test/',
    };
    expect(
      (
        await owner
          .put(`${route}/settings`)
          .set('Origin', origin)
          .send(settings)
      ).status,
    ).toBe(200);
    expect((await member.get(`${route}/settings`)).body.settings).toEqual(
      settings,
    );
    expect(
      (
        await member
          .put(`${route}/settings`)
          .set('Origin', origin)
          .send(settings)
      ).status,
    ).toBe(403);
    expect(
      (
        await owner
          .put(`${route}/settings`)
          .set('Origin', origin)
          .send({ ...settings, website: 'javascript:alert(1)' })
      ).status,
    ).toBe(400);
    expect((await outsider.get(`${route}/settings`)).status).toBe(404);
    expect((await owner.get(`${secondRoute}/settings`)).status).toBe(404);

    expect(
      (
        await owner
          .put(`${route}/enabled`)
          .set('Origin', origin)
          .send({ enabled: false })
      ).status,
    ).toBe(204);
    expect((await member.get(`${route}/settings`)).status).toBe(404);
    expect(
      (
        await owner
          .put(`${route}/settings`)
          .set('Origin', origin)
          .send(settings)
      ).status,
    ).toBe(404);
    expect(
      (
        await owner
          .put(`${route}/enabled`)
          .set('Origin', origin)
          .send({ enabled: true })
      ).status,
    ).toBe(204);
    expect((await owner.get(`${route}/settings`)).body.settings).toEqual(
      settings,
    );
    await database.db
      .update(organizationModules)
      .set({ settingsVersion: 999 })
      .where(
        and(
          eq(organizationModules.organizationId, first),
          eq(organizationModules.moduleKey, key),
        ),
      );
    expect((await owner.get(`${route}/settings`)).body.error.code).toBe(
      'MODULE_MIGRATION_REQUIRED',
    );
    await database.db
      .update(organizationModules)
      .set({ settingsVersion: 1 })
      .where(
        and(
          eq(organizationModules.organizationId, first),
          eq(organizationModules.moduleKey, key),
        ),
      );
    await database.db
      .delete(moduleEntitlements)
      .where(
        and(
          eq(moduleEntitlements.organizationId, first),
          eq(moduleEntitlements.moduleKey, key),
        ),
      );
    expect((await member.get(`${route}/settings`)).status).toBe(404);
    expect(
      (await owner.get(`/api/organizations/${first}/modules`)).body.modules[0]
        .status,
    ).toBe('unavailable');
    const rollback = new Error('rollback test');
    await expect(
      database.db.transaction(async (tx) => {
        await seedDevelopmentEntitlements(tx);
        await seedDevelopmentEntitlements(tx);
        const entries = await tx
          .select()
          .from(moduleEntitlements)
          .where(
            and(
              eq(moduleEntitlements.organizationId, first),
              eq(moduleEntitlements.moduleKey, key),
            ),
          );
        expect(entries).toHaveLength(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await database.db
      .insert(moduleEntitlements)
      .values({ organizationId: first, moduleKey: key });
    expect((await owner.get(`${route}/settings`)).body.settings).toEqual(
      settings,
    );
  }, 30000);
});
