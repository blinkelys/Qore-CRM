import { and, eq, gt } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { createDatabase } from '../db/index.ts';
import { passwordResets, sessions, users } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import type { Mailer } from '../mail.ts';
import { hashPassword, hashToken, newToken, verifyPassword } from './crypto.ts';

type Database = ReturnType<typeof createDatabase>['db'];
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const resetLifetime = 60 * 60 * 1000;
const cookieName = 'qore_session';
const dummyHash =
  '2f40757e475b3f66726fd537b71da08f:ff38ca85bbbf42d68bf6dfeca3c1fcd03153ef9bfcfe74d1807f3ff1ac3e86ede93c1f2cc9fb10db8c208548421456357d11e0db3b40b5a45e1232ef19c5615e';
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
const passwordSchema = z.string().min(12).max(128);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'Please check the supplied information.',
    );
  return parsed.data;
}

export function requireOrigin(origin: string) {
  return (req: Request, _res: Response, next: () => void) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') !== origin
    ) {
      throw new HttpError(
        403,
        'INVALID_ORIGIN',
        'Request origin is not allowed.',
      );
    }
    next();
  };
}

function sessionCookie(res: Response, config: Config, token: string) {
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionLifetime,
  });
}

export async function currentUser(db: Database, req: Request) {
  const token: unknown = req.cookies?.[cookieName];
  if (typeof token !== 'string' || !tokenSchema.safeParse(token).success)
    return null;
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return user ?? null;
}

export async function requireUser(db: Database, req: Request) {
  const user = await currentUser(db, req);
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.');
  return user;
}

export function createAuthRouter(
  db: Database,
  config: Config,
  mailer: Mailer,
  logger: Logger,
) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Try again later.',
        },
      });
    },
  });
  router.use(
    [
      '/auth/register',
      '/auth/login',
      '/auth/forgot-password',
      '/auth/reset-password',
    ],
    limiter,
  );

  router.post('/auth/register', async (req, res) => {
    const data = parseBody(credentialsSchema, req.body);
    const passwordHash = await hashPassword(data.password);
    const token = newToken();
    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email: data.email, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id, email: users.email });
      if (!created)
        throw new HttpError(
          409,
          'EMAIL_IN_USE',
          'An account already uses this email.',
        );
      await tx.insert(sessions).values({
        tokenHash: hashToken(token),
        userId: created.id,
        expiresAt: new Date(Date.now() + sessionLifetime),
      });
      return created;
    });
    sessionCookie(res, config, token);
    res.status(201).json({ user });
  });

  router.post('/auth/login', async (req, res) => {
    const data = parseBody(credentialsSchema, req.body);
    const token = newToken();
    const user = await db.transaction(async (tx) => {
      const [found] = await tx
        .select()
        .from(users)
        .where(eq(users.email, data.email))
        .limit(1)
        .for('update');
      const valid = await verifyPassword(
        data.password,
        found?.passwordHash ?? dummyHash,
      );
      if (!found || !valid)
        throw new HttpError(
          401,
          'INVALID_CREDENTIALS',
          'Invalid email or password.',
        );
      await tx.insert(sessions).values({
        tokenHash: hashToken(token),
        userId: found.id,
        expiresAt: new Date(Date.now() + sessionLifetime),
      });
      return found;
    });
    sessionCookie(res, config, token);
    res.json({ user: { id: user.id, email: user.email } });
  });

  router.get('/auth/session', async (req, res) => {
    res.json({ user: await requireUser(db, req) });
  });

  router.post('/auth/logout', async (req, res) => {
    const token: unknown = req.cookies?.[cookieName];
    if (typeof token === 'string' && tokenSchema.safeParse(token).success) {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    }
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    res.status(204).end();
  });

  router.post('/auth/forgot-password', async (req, res) => {
    const { email } = parseBody(z.object({ email: emailSchema }), req.body);
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (user) {
      const token = newToken();
      const tokenHash = hashToken(token);
      await db.insert(passwordResets).values({
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + resetLifetime),
      });
      try {
        await mailer.send(
          email,
          'Reset your Qore password',
          `Reset your password using this link (valid for one hour):\n\n${config.APP_ORIGIN}/reset-password#${token}`,
        );
      } catch {
        await db
          .delete(passwordResets)
          .where(eq(passwordResets.tokenHash, tokenHash));
        logger.error('Password reset email delivery failed');
        throw new HttpError(
          503,
          'EMAIL_UNAVAILABLE',
          'Email delivery is unavailable. Try again later.',
        );
      }
    }
    res
      .status(202)
      .json({ message: 'If an account exists, a reset link has been sent.' });
  });

  router.post('/auth/reset-password', async (req, res) => {
    const data = parseBody(
      z.object({ token: tokenSchema, password: passwordSchema }),
      req.body,
    );
    const tokenHash = hashToken(data.token);
    const passwordHash = await hashPassword(data.password);
    await db.transaction(async (tx) => {
      const [reset] = await tx
        .select({ userId: passwordResets.userId })
        .from(passwordResets)
        .where(
          and(
            eq(passwordResets.tokenHash, tokenHash),
            gt(passwordResets.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!reset)
        throw new HttpError(
          400,
          'INVALID_TOKEN',
          'The reset link is invalid or expired.',
        );
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, reset.userId))
        .for('update');
      const [consumed] = await tx
        .delete(passwordResets)
        .where(
          and(
            eq(passwordResets.tokenHash, tokenHash),
            gt(passwordResets.expiresAt, new Date()),
          ),
        )
        .returning({ userId: passwordResets.userId });
      if (!consumed)
        throw new HttpError(
          400,
          'INVALID_TOKEN',
          'The reset link is invalid or expired.',
        );
      await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, consumed.userId));
      await tx
        .delete(passwordResets)
        .where(eq(passwordResets.userId, consumed.userId));
      await tx.delete(sessions).where(eq(sessions.userId, consumed.userId));
    });
    res.status(204).end();
  });
  return router;
}
