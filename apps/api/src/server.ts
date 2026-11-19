import pino from 'pino';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/index.ts';

const config = loadConfig(process.env);
const logger = pino({ level: config.LOG_LEVEL });
const database = createDatabase(config.DATABASE_URL, logger);
const app = createApp(logger, database.checkHealth);

const server = app.listen(config.PORT, '0.0.0.0', () => {
  logger.info({ port: config.PORT }, 'API listening');
});

process.once('SIGTERM', () => {
  server.close(() => {
    void database.close().catch(() => {
      logger.error('Failed to close database connections');
      process.exitCode = 1;
    });
  });
});
