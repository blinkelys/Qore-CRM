import { z } from 'zod';

const configSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().refine((value) => {
      if (!URL.canParse(value)) return false;
      const protocol = new URL(value).protocol;
      return protocol === 'postgres:' || protocol === 'postgresql:';
    }),
    APP_ORIGIN: z.string().refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
    }),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    SMTP_REQUIRE_TLS: z.enum(['true', 'false']).default('false'),
    SMTP_USER: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    SMTP_PASSWORD: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    MAIL_FROM: z.email(),
    TRUST_PROXY: z.enum(['0', '1']).default('0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((config, context) => {
    if (Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASSWORD)) {
      context.addIssue({
        code: 'custom',
        path: ['SMTP_USER'],
        message: 'SMTP credentials must be paired',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      (!config.APP_ORIGIN.startsWith('https://') ||
        (config.SMTP_SECURE !== 'true' && config.SMTP_REQUIRE_TLS !== 'true'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message: 'Production requires HTTPS and encrypted SMTP',
      });
    }
  });

export function loadConfig(env: NodeJS.ProcessEnv) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }

  return result.data;
}

export type Config = ReturnType<typeof loadConfig>;
