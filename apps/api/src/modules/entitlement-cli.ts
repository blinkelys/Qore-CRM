import pino from 'pino';
import { databaseUrlSchema } from '../config.ts';
import { createDatabase } from '../db/index.ts';
import { HttpError } from '../http.ts';
import { setEntitlement } from './entitlements.ts';

const logger = pino();

async function main() {
  const [action, organizationId, moduleKey, ...extra] = process.argv.slice(2);
  if (
    (action !== 'grant' && action !== 'revoke') ||
    !organizationId ||
    !moduleKey ||
    extra.length
  ) {
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'Usage: modules:entitlement -- <grant|revoke> <organization-id> <module-key>',
    );
  }
  const url = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!url.success)
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'A valid DATABASE_URL is required.',
    );
  const database = createDatabase(url.data, logger);
  try {
    await setEntitlement(database.db, organizationId, moduleKey, action);
    console.log(`Entitlement ${action === 'grant' ? 'granted' : 'revoked'}.`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof HttpError) console.error(error.message);
  else logger.error('Entitlement operation failed');
  process.exitCode = 1;
});
