import cookieParser from 'cookie-parser';
import express, { type Router } from 'express';
import type { Logger } from 'pino';
import { requireOrigin } from './auth/routes.ts';
import { errorHandler } from './http.ts';

export function createApp(
  logger: Logger,
  checkDatabase: () => Promise<void>,
  api?: { router: Router; origin: string; trustProxy: boolean },
) {
  const app = express();
  app.disable('x-powered-by');
  if (api?.trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        'request completed',
      );
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ status: 'ok' });
    } catch {
      logger.error('Database health check failed');
      res.status(503).json({
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database is unavailable.',
        },
      });
    }
  });

  if (api) {
    app.use(
      '/api',
      (_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
      },
      requireOrigin(api.origin),
      api.router,
    );
  }

  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  });

  app.use(errorHandler(logger));
  return app;
}
