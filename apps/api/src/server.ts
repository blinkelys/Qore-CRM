import pino from 'pino';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/index.ts';
import { createAuthRouter } from './auth/routes.ts';
import { createMailer } from './mail.ts';
import { createOrganizationRouter } from './organizations/routes.ts';
import { Router } from 'express';
import { seedDevelopmentEntitlements } from './modules/development.ts';
import { createModuleRouter } from './modules/routes.ts';

const config = loadConfig(process.env);
const logger = pino({ level: config.LOG_LEVEL });
const database = createDatabase(config.DATABASE_URL, logger);
if (config.SEED_DEVELOPMENT_ENTITLEMENTS === 'true') {
  try {
    await seedDevelopmentEntitlements(database.db);
    logger.info('Development module entitlements seeded');
  } catch {
    logger.error('Failed to seed development module entitlements');
    await database.close();
    process.exit(1);
  }
}
const mailer = createMailer(config);
const router = Router()
  .use(createAuthRouter(database.db, config, mailer, logger))
  .use(createOrganizationRouter(database.db, config, mailer, logger))
  .use(createModuleRouter(database.db));
const app = createApp(logger, database.checkHealth, {
  router,
  origin: config.APP_ORIGIN,
  trustProxy: config.TRUST_PROXY === '1',
});

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
