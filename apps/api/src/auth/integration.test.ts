import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createDatabase } from '../db/index.ts';
import { passwordResets, sessions, users } from '../db/schema.ts';
import { hashToken } from './crypto.ts';
import { createAuthRouter } from './routes.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = 'http://localhost:8080';
const email = `auth-${randomUUID()}@example.test`;
const logger = pino({ level: 'silent' });

describe.skipIf(!databaseUrl)('authentication with PostgreSQL', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl ?? 'postgres://localhost/qore',
    APP_ORIGIN: origin,
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    MAIL_FROM: 'noreply@example.test',
  });
  const database = createDatabase(config.DATABASE_URL, logger);
  const messages: string[] = [];
  const mailer = {
    async send(_to: string, _subject: string, text: string) {
      messages.push(text);
    },
  };
  const app = createApp(logger, database.checkHealth, {
    router: createAuthRouter(database.db, config, mailer, logger),
    origin,
    trustProxy: false,
  });
  const agent = request.agent(app);

  beforeAll(async () => database.checkHealth());
  afterAll(async () => {
    await database.db.delete(users).where(inArray(users.email, [email]));
    await database.close();
  });

  it('protects registration and sessions and supports single-use password recovery', async () => {
    const credentials = { email, password: 'a secure password 123' };
    expect(
      (await agent.post('/api/auth/register').send(credentials)).status,
    ).toBe(403);
    const registration = await agent
      .post('/api/auth/register')
      .set('Origin', origin)
      .send(credentials);
    expect(registration.status).toBe(201);
    expect(registration.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(registration.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect((await agent.get('/api/auth/session')).body.user.email).toBe(email);
    expect(
      (
        await agent
          .post('/api/auth/logout')
          .set('Origin', 'https://evil.example')
      ).status,
    ).toBe(403);
    expect((await agent.get('/api/auth/session')).status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ ...credentials, password: 'wrong password 123' })
      ).status,
    ).toBe(401);

    expect(
      (
        await agent
          .post('/api/auth/forgot-password')
          .set('Origin', origin)
          .send({ email })
      ).status,
    ).toBe(202);
    const token = messages[0]?.split('#')[1];
    expect(token).toBeTruthy();
    const stored = await database.db
      .select()
      .from(passwordResets)
      .where(eq(passwordResets.userId, registration.body.user.id));
    expect(stored[0]?.tokenHash).toBe(hashToken(token));
    expect(stored[0]?.tokenHash).not.toBe(token);

    const password = 'a different secure password';
    expect(
      (
        await agent
          .post('/api/auth/reset-password')
          .set('Origin', origin)
          .send({ token, password })
      ).status,
    ).toBe(204);
    expect((await agent.get('/api/auth/session')).status).toBe(401);
    expect(
      (
        await agent
          .post('/api/auth/reset-password')
          .set('Origin', origin)
          .send({ token, password })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post('/api/auth/login')
          .set('Origin', origin)
          .send(credentials)
      ).status,
    ).toBe(401);
    expect(
      (
        await agent
          .post('/api/auth/login')
          .set('Origin', origin)
          .send({ email, password })
      ).status,
    ).toBe(200);
    await database.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.userId, registration.body.user.id));
    expect((await agent.get('/api/auth/session')).status).toBe(401);
  }, 30000);

  it('rejects expired recovery links and does not enumerate unknown emails', async () => {
    const unknown = await agent
      .post('/api/auth/forgot-password')
      .set('Origin', origin)
      .send({ email: `unknown-${randomUUID()}@example.test` });
    const known = await agent
      .post('/api/auth/forgot-password')
      .set('Origin', origin)
      .send({ email });
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    const token = messages.at(-1)?.split('#')[1];
    expect(token).toBeTruthy();
    await database.db
      .update(passwordResets)
      .set({ expiresAt: new Date(0) })
      .where(eq(passwordResets.tokenHash, hashToken(token)));
    expect(
      (
        await agent
          .post('/api/auth/reset-password')
          .set('Origin', origin)
          .send({ token, password: 'another secure password' })
      ).status,
    ).toBe(400);
  }, 30000);
});
