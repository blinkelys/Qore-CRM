import pino from 'pino';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig(process.env);
const logger = pino({ level: config.LOG_LEVEL });
const app = createApp(logger);

app.listen(config.PORT, '0.0.0.0', () => {
  logger.info({ port: config.PORT }, 'API listening');
});
