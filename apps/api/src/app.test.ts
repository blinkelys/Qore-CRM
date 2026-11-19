import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const logger = pino({ level: 'silent' });
const app = createApp(logger, async () => {});
const baseEnv = {
  DATABASE_URL: 'postgres://localhost/qore',
  APP_ORIGIN: 'http://localhost:8080',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'noreply@example.test',
};

describe('API foundation', () => {
  it('returns health status', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports an unavailable database without leaking the underlying error', async () => {
    const unhealthy = createApp(logger, async () => {
      throw new Error('private database details');
    });
    const response = await request(unhealthy).get('/api/health');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain(
      'private database details',
    );
  });

  it('returns consistent errors for unknown routes and invalid JSON', async () => {
    const missing = await request(app).get('/api/missing');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const invalid = await request(app)
      .post('/api/missing')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_JSON');
  });

  it('rejects invalid configuration without exposing values', () => {
    expect(() => loadConfig({ ...baseEnv, PORT: 'secret' })).toThrow(
      'Invalid configuration: PORT',
    );
    expect(() =>
      loadConfig({ ...baseEnv, DATABASE_URL: 'https://example.com' }),
    ).toThrow('Invalid configuration: DATABASE_URL');
    expect(() => loadConfig({ ...baseEnv, DATABASE_URL: 'invalid' })).toThrow(
      'Invalid configuration: DATABASE_URL',
    );
    expect(() =>
      loadConfig({
        ...baseEnv,
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://example.test',
        SMTP_SECURE: 'true',
        SEED_DEVELOPMENT_ENTITLEMENTS: 'true',
      }),
    ).toThrow('Invalid configuration: SEED_DEVELOPMENT_ENTITLEMENTS');
  });
});
