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
import {
  memberships,
  opportunities,
  organizations,
  users,
} from '../db/schema.ts';
import { setEntitlement } from '../modules/entitlements.ts';
import { createModuleRouter } from '../modules/routes.ts';
import { createOrganizationRouter } from '../organizations/routes.ts';
import { createOpportunitiesRouter } from './routes.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'http://localhost:8080';
const emails = ['owner', 'member', 'outsider'].map(
  (name) => `${name}-${randomUUID()}@example.test`,
);
const logger = pino({ level: 'silent' });

describe.skipIf(!databaseUrl)('opportunities with PostgreSQL', () => {
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
    .use(createOpportunitiesRouter(database.db));
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

  it('scopes stages and opportunities, enforces roles, conflicts and retention', async () => {
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
    const base = `/api/organizations/${first}/opportunities`;
    const other = `/api/organizations/${second}/opportunities`;
    expect((await owner.get(base)).status).toBe(404);
    for (const org of orgIds) {
      expect(
        (
          await owner
            .put(`/api/organizations/${org}/modules/opportunities/enabled`)
            .set('Origin', origin)
            .send({ enabled: true })
        ).status,
      ).toBe(204);
    }
    expect((await outsider.get(base)).status).toBe(404);
    expect(
      (
        await member
          .post(`${base}/stages`)
          .set('Origin', origin)
          .send({ name: 'Forbidden' })
      ).status,
    ).toBe(403);
    const firstStage = await owner
      .post(`${base}/stages`)
      .set('Origin', origin)
      .send({ name: 'New' });
    const secondStage = await owner
      .post(`${base}/stages`)
      .set('Origin', origin)
      .send({ name: 'Qualified' });
    const foreignStage = await owner
      .post(`${other}/stages`)
      .set('Origin', origin)
      .send({ name: 'New' });
    expect([
      firstStage.status,
      secondStage.status,
      foreignStage.status,
    ]).toEqual([201, 201, 201]);
    const firstId: string = firstStage.body.stage.id;
    const secondId: string = secondStage.body.stage.id;
    const foreignId: string = foreignStage.body.stage.id;
    expect(
      (
        await owner
          .post(`${base}/stages`)
          .set('Origin', origin)
          .send({ name: ' NEW ' })
      ).body.error.code,
    ).toBe('STAGE_NAME_IN_USE');
    expect(
      (
        await owner
          .put(`${base}/stages/${secondId}/move`)
          .set('Origin', origin)
          .send({ version: 1, direction: 'up' })
      ).status,
    ).toBe(204);
    const stages = (await member.get(`${base}/stages`)).body.stages;
    expect(stages.map((stage: { id: string }) => stage.id)).toEqual([
      secondId,
      firstId,
    ]);
    expect(
      (
        await owner
          .put(`${base}/stages/${firstId}`)
          .set('Origin', origin)
          .send({ name: 'Stale', version: 1 })
      ).body.error.code,
    ).toBe('STAGE_CONFLICT');
    expect(
      (
        await owner
          .put(`${base}/stages/${foreignId}`)
          .set('Origin', origin)
          .send({ name: 'Wrong', version: 1 })
      ).status,
    ).toBe(404);
    const badStage = await member
      .post(base)
      .set('Origin', origin)
      .send({ name: 'Foreign', stageId: foreignId, amount: '', currency: '' });
    expect(badStage.status).toBe(404);
    await expect(
      database.db.insert(opportunities).values({
        organizationId: first,
        stageId: foreignId,
        name: 'wrong tenant',
      }),
    ).rejects.toThrow();
    expect(
      (
        await member.post(base).set('Origin', origin).send({
          name: 'Invalid',
          stageId: firstId,
          amount: '1.999',
          currency: 'USD',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await member.post(base).set('Origin', origin).send({
          name: 'Invalid',
          stageId: firstId,
          amount: '10',
          currency: '',
        })
      ).status,
    ).toBe(400);
    const created = await member.post(base).set('Origin', origin).send({
      name: ' Renewal ',
      stageId: firstId,
      amount: '1200.50',
      currency: 'usd',
    });
    expect(created.status).toBe(201);
    expect(created.body.opportunity).toMatchObject({
      name: 'Renewal',
      stageId: firstId,
      amount: '1200.50',
      currency: 'USD',
      version: 1,
    });
    const id: string = created.body.opportunity.id;
    expect((await owner.get(`${other}/${id}`)).status).toBe(404);
    expect(
      (await member.get(base).query({ q: 'NEWAL', stageId: firstId })).body
        .total,
    ).toBe(1);
    expect((await member.get(base).query({ q: '%' })).body.total).toBe(0);
    expect((await owner.get(base).query({ stageId: foreignId })).status).toBe(
      404,
    );
    expect(
      (
        await owner
          .put(`${base}/stages/${firstId}/archive`)
          .set('Origin', origin)
          .send({ version: 2, archived: true })
      ).body.error.code,
    ).toBe('STAGE_HAS_OPPORTUNITIES');
    const moved = await member.put(`${base}/${id}`).set('Origin', origin).send({
      name: 'Renewal',
      stageId: secondId,
      amount: '',
      currency: '',
      version: 1,
    });
    expect(moved.body.opportunity).toMatchObject({
      stageId: secondId,
      amount: null,
      currency: null,
      version: 2,
    });
    expect(
      (
        await owner.put(`${base}/${id}`).set('Origin', origin).send({
          name: 'Stale',
          stageId: firstId,
          amount: '',
          currency: '',
          version: 1,
        })
      ).body.error.code,
    ).toBe('OPPORTUNITY_CONFLICT');
    expect(
      (
        await member
          .put(`${base}/${id}/archive`)
          .set('Origin', origin)
          .send({ version: 2, archived: true })
      ).body.opportunity.version,
    ).toBe(3);
    expect(
      (
        await owner
          .put(`${base}/stages/${secondId}/archive`)
          .set('Origin', origin)
          .send({ version: 2, archived: true })
      ).body.stage.version,
    ).toBe(3);
    expect(
      (
        await owner
          .delete(`${base}/stages/${secondId}`)
          .set('Origin', origin)
          .send({ version: 3 })
      ).body.error.code,
    ).toBe('STAGE_HAS_HISTORY');
    expect(
      (
        await owner
          .put(`${base}/${id}/archive`)
          .set('Origin', origin)
          .send({ version: 3, archived: false })
      ).body.error.code,
    ).toBe('STAGE_INACTIVE');
    expect(
      (
        await owner.post(base).set('Origin', origin).send({
          name: 'Invalid',
          stageId: secondId,
          amount: '',
          currency: '',
        })
      ).body.error.code,
    ).toBe('STAGE_INACTIVE');
    expect(
      (await owner.get(base).query({ status: 'archived' })).body.total,
    ).toBe(1);
    expect(
      (
        await owner
          .put(`${base}/stages/${secondId}/archive`)
          .set('Origin', origin)
          .send({ version: 3, archived: false })
      ).body.stage.version,
    ).toBe(4);
    expect(
      (
        await member
          .put(`${base}/${id}/archive`)
          .set('Origin', origin)
          .send({ version: 3, archived: false })
      ).body.opportunity.version,
    ).toBe(4);
    await database.db.insert(opportunities).values(
      Array.from({ length: 20 }, (_, i) => ({
        organizationId: first,
        stageId: firstId,
        name: `Deal ${String(i).padStart(2, '0')}`,
      })),
    );
    const page = await owner.get(base).query({ page: 2 });
    expect(page.body).toMatchObject({ total: 21, page: 2, pageSize: 20 });
    expect(page.body.opportunities).toHaveLength(1);
    await owner
      .put(`/api/organizations/${first}/modules/opportunities/enabled`)
      .set('Origin', origin)
      .send({ enabled: false });
    expect((await member.get(base)).status).toBe(404);
    expect((await owner.get(`${base}/stages`)).status).toBe(404);
    await owner
      .put(`/api/organizations/${first}/modules/opportunities/enabled`)
      .set('Origin', origin)
      .send({ enabled: true });
    await setEntitlement(database.db, first, 'opportunities', 'revoke');
    expect((await member.get(`${base}/${id}`)).status).toBe(404);
    await setEntitlement(database.db, first, 'opportunities', 'grant');
    expect((await member.get(`${base}/${id}`)).body.opportunity).toMatchObject({
      name: 'Renewal',
      stageId: secondId,
    });
    expect((await owner.get(`${base}/stages`)).body.stages).toHaveLength(2);
    const unused = await owner
      .post(`${base}/stages`)
      .set('Origin', origin)
      .send({ name: 'Unused' });
    expect(
      (
        await owner
          .delete(`${base}/stages/${unused.body.stage.id}`)
          .set('Origin', origin)
          .send({ version: 1 })
      ).status,
    ).toBe(204);
  });
});
