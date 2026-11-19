import express, { type ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';

export function createApp(logger: Logger) {
  const app = express();
  app.disable('x-powered-by');
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

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  });

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body.' },
      });
      return;
    }
    if (
      error instanceof Error &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      res.status(413).json({
        error: {
          code: 'BODY_TOO_LARGE',
          message: 'Request body is too large.',
        },
      });
      return;
    }
    logger.error('Unhandled request error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
    });
  };
  app.use(handleError);
  return app;
}
