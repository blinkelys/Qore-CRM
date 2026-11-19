import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { hashToken } from '../auth/crypto.ts';
import { createAuthRouter } from '../auth/routes.ts';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/index.ts';
import { invitations, organizations, users } from '../db/schema.ts';
import { createOrganizationRouter } from './routes.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'http://localhost:8080';
const suffix = randomUUID();
const emails = ['owner', 'admin', 'member', 'outsider'].map(
  (name) => `${name}-${suffix}@example.test`,
);
const logger = pino({ level: 'silent' });

describe.skipIf(!databaseUrl)(
  'organization authorization with PostgreSQL',
  () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl ?? 'postgres://localhost/qore',
      APP_ORIGIN: origin,
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      MAIL_FROM: 'noreply@example.test',
    });
    const database = createDatabase(config.DATABASE_URL, logger);
    const messages: { to: string; text: string }[] = [];
    const mailer = {
      async send(to: string, _subject: string, text: string) {
        messages.push({ to, text });
      },
    };
    const router = Router()
      .use(createAuthRouter(database.db, config, mailer, logger))
      .use(createOrganizationRouter(database.db, config, mailer, logger));
    const app = createApp(logger, database.checkHealth, {
      router,
      origin,
      trustProxy: false,
    });
    const owner = request.agent(app);
    const admin = request.agent(app);
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

    it('enforces tenant boundaries, invitation rules, roles and the last-owner invariant', async () => {
      const agents = [owner, admin, member, outsider];
      const userIds: string[] = [];
      for (let i = 0; i < agents.length; i++) {
        const response = await agents[i]
          .post('/api/auth/register')
          .set('Origin', origin)
          .send({ email: emails[i], password: 'a secure password 123' });
        expect(response.status).toBe(201);
        userIds.push(response.body.user.id);
      }

      const created = await owner
        .post('/api/organizations')
        .set('Origin', origin)
        .send({ name: 'Acme' });
      expect(created.status).toBe(201);
      const orgId: string = created.body.organization.id;
      orgIds.push(orgId);
      const other = await owner
        .post('/api/organizations')
        .set('Origin', origin)
        .send({ name: 'Other' });
      orgIds.push(other.body.organization.id);
      expect(
        (await owner.get('/api/organizations')).body.organizations,
      ).toHaveLength(2);
      expect(
        (await outsider.get(`/api/organizations/${orgId}/members`)).status,
      ).toBe(404);
      expect(
        (
          await outsider
            .patch(`/api/organizations/${orgId}/members/${userIds[0]}`)
            .set('Origin', origin)
            .send({ role: 'member' })
        ).status,
      ).toBe(404);
      expect(
        (
          await owner
            .patch(`/api/organizations/${orgId}/members/${userIds[0]}`)
            .set('Origin', origin)
            .send({ role: 'member' })
        ).body.error.code,
      ).toBe('LAST_OWNER');

      expect(
        (
          await owner
            .post(`/api/organizations/${orgId}/invitations`)
            .set('Origin', origin)
            .send({ email: emails[1], role: 'admin' })
        ).status,
      ).toBe(201);
      const adminToken = messages.at(-1)?.text.split('#')[1];
      expect(
        (
          await outsider
            .post('/api/invitations/accept')
            .set('Origin', origin)
            .send({ token: adminToken })
        ).status,
      ).toBe(403);
      expect(
        (
          await admin
            .post('/api/invitations/accept')
            .set('Origin', origin)
            .send({ token: adminToken })
        ).status,
      ).toBe(200);
      expect(
        (
          await admin
            .post('/api/invitations/accept')
            .set('Origin', origin)
            .send({ token: adminToken })
        ).status,
      ).toBe(400);
      expect(
        (
          await admin.get(
            `/api/organizations/${other.body.organization.id}/members`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await admin
            .post(`/api/organizations/${orgId}/invitations`)
            .set('Origin', origin)
            .send({ email: emails[2], role: 'owner' })
        ).status,
      ).toBe(403);
      expect(
        (
          await admin
            .post(`/api/organizations/${orgId}/invitations`)
            .set('Origin', origin)
            .send({ email: emails[2], role: 'member' })
        ).status,
      ).toBe(201);
      const memberToken = messages.at(-1)?.text.split('#')[1];
      expect(
        (
          await member
            .post('/api/invitations/accept')
            .set('Origin', origin)
            .send({ token: memberToken })
        ).status,
      ).toBe(200);
      expect(
        (await member.get(`/api/organizations/${orgId}/members`)).body.members,
      ).toHaveLength(3);
      expect(
        (
          await member
            .delete(`/api/organizations/${orgId}/members/${userIds[1]}`)
            .set('Origin', origin)
        ).status,
      ).toBe(403);
      expect(
        (
          await admin
            .patch(`/api/organizations/${orgId}/members/${userIds[2]}`)
            .set('Origin', origin)
            .send({ role: 'admin' })
        ).status,
      ).toBe(403);
      expect(
        (
          await admin
            .delete(`/api/organizations/${orgId}/members/${userIds[0]}`)
            .set('Origin', origin)
        ).status,
      ).toBe(403);

      expect(
        (
          await owner
            .patch(`/api/organizations/${orgId}/members/${userIds[1]}`)
            .set('Origin', origin)
            .send({ role: 'owner' })
        ).status,
      ).toBe(204);
      const changes = await Promise.all([
        owner
          .patch(`/api/organizations/${orgId}/members/${userIds[0]}`)
          .set('Origin', origin)
          .send({ role: 'member' }),
        owner
          .patch(`/api/organizations/${orgId}/members/${userIds[1]}`)
          .set('Origin', origin)
          .send({ role: 'member' }),
      ]);
      expect(
        changes.filter((response) => response.status === 204),
      ).toHaveLength(1);
      expect(
        changes.filter((response) => response.status !== 204),
      ).toHaveLength(1);
      const remaining = await member.get(`/api/organizations/${orgId}/members`);
      expect(
        remaining.body.members.filter(
          (entry: { role: string }) => entry.role === 'owner',
        ),
      ).toHaveLength(1);
      const remainingOwner = remaining.body.members.find(
        (entry: { role: string }) => entry.role === 'owner',
      );
      const manager = remainingOwner.id === userIds[0] ? owner : admin;
      const formerOwner = remainingOwner.id === userIds[0] ? admin : owner;
      const formerOwnerId =
        remainingOwner.id === userIds[0] ? userIds[1] : userIds[0];
      expect(
        (
          await manager
            .patch(`/api/organizations/${orgId}/members/${formerOwnerId}`)
            .set('Origin', origin)
            .send({ role: 'admin' })
        ).status,
      ).toBe(204);
      expect(
        (
          await formerOwner
            .post(`/api/organizations/${orgId}/invitations`)
            .set('Origin', origin)
            .send({ email: emails[3], role: 'member' })
        ).status,
      ).toBe(201);
      const revokedToken = messages.at(-1)?.text.split('#')[1];
      expect(
        (
          await manager
            .delete(`/api/organizations/${orgId}/members/${formerOwnerId}`)
            .set('Origin', origin)
        ).status,
      ).toBe(204);
      expect(
        (
          await outsider
            .post('/api/invitations/accept')
            .set('Origin', origin)
            .send({ token: revokedToken })
        ).status,
      ).toBe(400);
      expect(
        (
          await manager
            .delete(`/api/organizations/${orgId}/members/${userIds[2]}`)
            .set('Origin', origin)
        ).status,
      ).toBe(204);
      expect(
        (await member.get(`/api/organizations/${orgId}/members`)).status,
      ).toBe(404);
    }, 30000);

    it('rejects expired invitations without adding a member', async () => {
      const created = await outsider
        .post('/api/organizations')
        .set('Origin', origin)
        .send({ name: 'Third' });
      const orgId: string = created.body.organization.id;
      orgIds.push(orgId);
      expect(
        (
          await outsider
            .post(`/api/organizations/${orgId}/invitations`)
            .set('Origin', origin)
            .send({ email: emails[2], role: 'member' })
        ).status,
      ).toBe(201);
      const token = messages.at(-1)?.text.split('#')[1];
      expect(token).toBeTruthy();
      await database.db
        .update(invitations)
        .set({ expiresAt: new Date(0) })
        .where(eq(invitations.tokenHash, hashToken(token)));
      expect(
        (
          await member
            .post('/api/invitations/accept')
            .set('Origin', origin)
            .send({ token })
        ).status,
      ).toBe(400);
      expect(
        (await member.get(`/api/organizations/${orgId}/members`)).status,
      ).toBe(404);
    }, 30000);
  },
);
