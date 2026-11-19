import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const logger = pino({ level: 'silent' });
const app = createApp(logger, async () => {});

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
    expect(() =>
      loadConfig({ PORT: 'secret', DATABASE_URL: 'postgres://localhost/qore' }),
    ).toThrow('Invalid configuration: PORT');
    expect(() => loadConfig({ DATABASE_URL: 'https://example.com' })).toThrow(
      'Invalid configuration: DATABASE_URL',
    );
    expect(() => loadConfig({ DATABASE_URL: 'invalid' })).toThrow(
      'Invalid configuration: DATABASE_URL',
    );
  });
});
