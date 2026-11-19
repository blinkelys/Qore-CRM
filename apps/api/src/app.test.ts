import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const app = createApp(pino({ level: 'silent' }));

describe('API foundation', () => {
  it('returns health status', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
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
    expect(() => loadConfig({ PORT: 'secret' })).toThrow(
      'Invalid configuration: PORT',
    );
  });
});
