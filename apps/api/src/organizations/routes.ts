import { and, eq, gt } from 'drizzle-orm';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Logger } from 'pino';
import { z } from 'zod';
import { hashToken, newToken } from '../auth/crypto.ts';
import {
  emailSchema,
  parseBody,
  requireUser,
  tokenSchema,
} from '../auth/routes.ts';
import type { Config } from '../config.ts';
import {
  invitations,
  memberships,
  moduleEntitlements,
  organizations,
  users,
} from '../db/schema.ts';
import { HttpError } from '../http.ts';
import type { Mailer } from '../mail.ts';
import { developmentEntitlements } from '../modules/development.ts';
import {
  lockOrganization,
  membership,
  parseId,
  type Database,
  type Transaction,
} from './access.ts';

const roleSchema = z.enum(['owner', 'admin', 'member']);

function requireManager(role: string) {
  if (role !== 'owner' && role !== 'admin') {
    throw new HttpError(
      403,
      'FORBIDDEN',
      'You cannot manage members in this organization.',
    );
  }
}

async function protectLastOwner(
  tx: Transaction,
  organizationId: string,
  role: string,
  newRole?: string,
) {
  if (role !== 'owner' || newRole === 'owner') return;
  const owners = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, 'owner'),
      ),
    );
  if (owners.length <= 1)
    throw new HttpError(
      409,
      'LAST_OWNER',
      'An organization must have at least one owner.',
    );
}

export function createOrganizationRouter(
  db: Database,
  config: Config,
  mailer: Mailer,
  logger: Logger,
) {
  const router = Router();
  const invitationLimit = rateLimit({
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

  router.get('/organizations', async (req, res) => {
    const user = await requireUser(db, req);
    const result = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(eq(memberships.userId, user.id))
      .orderBy(organizations.createdAt);
    res.json({ organizations: result });
  });

  router.post('/organizations', async (req, res) => {
    const user = await requireUser(db, req);
    const { name } = parseBody(
      z.object({ name: z.string().trim().min(1).max(100) }),
      req.body,
    );
    const organization = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizations)
        .values({ name })
        .returning({ id: organizations.id, name: organizations.name });
      await tx
        .insert(memberships)
        .values({ organizationId: created.id, userId: user.id, role: 'owner' });
      if (config.SEED_DEVELOPMENT_ENTITLEMENTS === 'true') {
        const values = developmentEntitlements([created.id]);
        if (values.length) await tx.insert(moduleEntitlements).values(values);
      }
      return created;
    });
    res.status(201).json({ organization: { ...organization, role: 'owner' } });
  });

  router.get('/organizations/:organizationId/members', async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const members = await db.transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      if (!(await membership(tx, organizationId, user.id))) {
        throw new HttpError(404, 'NOT_FOUND', 'Organization not found.');
      }
      return tx
        .select({ id: users.id, email: users.email, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, organizationId))
        .orderBy(memberships.createdAt);
    });
    res.json({ members });
  });

  router.post(
    '/organizations/:organizationId/invitations',
    invitationLimit,
    async (req, res) => {
      const user = await requireUser(db, req);
      const organizationId = parseId(req.params.organizationId);
      const { email, role } = parseBody(
        z.object({ email: emailSchema, role: roleSchema }),
        req.body,
      );
      const token = newToken();
      const tokenHash = hashToken(token);
      const organization = await db.transaction(async (tx) => {
        const org = await lockOrganization(tx, organizationId);
        const actor = await membership(tx, organizationId, user.id);
        if (!actor)
          throw new HttpError(404, 'NOT_FOUND', 'Organization not found.');
        requireManager(actor.role);
        if (actor.role !== 'owner' && role !== 'member') {
          throw new HttpError(
            403,
            'FORBIDDEN',
            'Only owners can invite administrators or owners.',
          );
        }
        const [existing] = await tx
          .select({ id: users.id })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(users.email, email),
            ),
          );
        if (existing)
          throw new HttpError(
            409,
            'ALREADY_MEMBER',
            'This user is already a member.',
          );
        await tx
          .delete(invitations)
          .where(
            and(
              eq(invitations.organizationId, organizationId),
              eq(invitations.email, email),
            ),
          );
        await tx.insert(invitations).values({
          tokenHash,
          organizationId,
          email,
          role,
          invitedBy: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        return org;
      });
      try {
        await mailer.send(
          email,
          'Your Qore organization invitation',
          `You have been invited to ${organization.name}. Sign in or register with ${email}, then open this link (valid for seven days):\n\n${config.APP_ORIGIN}/accept-invitation#${token}`,
        );
      } catch {
        await db
          .delete(invitations)
          .where(eq(invitations.tokenHash, tokenHash));
        logger.error('Invitation email delivery failed');
        throw new HttpError(
          503,
          'EMAIL_UNAVAILABLE',
          'Email delivery is unavailable. Try again later.',
        );
      }
      res.status(201).json({ message: 'Invitation sent.' });
    },
  );

  router.post('/invitations/accept', invitationLimit, async (req, res) => {
    const user = await requireUser(db, req);
    const { token } = parseBody(z.object({ token: tokenSchema }), req.body);
    const tokenHash = hashToken(token);
    const organization = await db.transaction(async (tx) => {
      const [pending] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.tokenHash, tokenHash));
      if (!pending)
        throw new HttpError(
          400,
          'INVALID_TOKEN',
          'The invitation is invalid or expired.',
        );
      const org = await lockOrganization(tx, pending.organizationId);
      const [invitation] = await tx
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.tokenHash, tokenHash),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .for('update');
      if (!invitation)
        throw new HttpError(
          400,
          'INVALID_TOKEN',
          'The invitation is invalid or expired.',
        );
      const inviter = await membership(tx, org.id, invitation.invitedBy);
      if (
        !inviter ||
        inviter.role === 'member' ||
        (inviter.role === 'admin' && invitation.role !== 'member')
      ) {
        throw new HttpError(
          400,
          'INVALID_TOKEN',
          'The invitation is invalid or expired.',
        );
      }
      if (invitation.email !== user.email) {
        throw new HttpError(
          403,
          'INVITATION_EMAIL_MISMATCH',
          'Sign in with the email address that received this invitation.',
        );
      }
      const [created] = await tx
        .insert(memberships)
        .values({
          organizationId: org.id,
          userId: user.id,
          role: invitation.role,
        })
        .onConflictDoNothing()
        .returning();
      if (!created)
        throw new HttpError(409, 'ALREADY_MEMBER', 'You are already a member.');
      await tx.delete(invitations).where(eq(invitations.tokenHash, tokenHash));
      return { id: org.id, name: org.name, role: invitation.role };
    });
    res.json({ organization });
  });

  router.patch(
    '/organizations/:organizationId/members/:userId',
    async (req, res) => {
      const user = await requireUser(db, req);
      const organizationId = parseId(req.params.organizationId);
      const userId = parseId(req.params.userId);
      const { role } = parseBody(z.object({ role: roleSchema }), req.body);
      await db.transaction(async (tx) => {
        await lockOrganization(tx, organizationId);
        const actor = await membership(tx, organizationId, user.id);
        if (!actor)
          throw new HttpError(404, 'NOT_FOUND', 'Organization not found.');
        if (actor.role !== 'owner')
          throw new HttpError(
            403,
            'FORBIDDEN',
            'Only owners can change roles.',
          );
        const target = await membership(tx, organizationId, userId);
        if (!target) throw new HttpError(404, 'NOT_FOUND', 'Member not found.');
        await protectLastOwner(tx, organizationId, target.role, role);
        await tx
          .update(memberships)
          .set({ role })
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.userId, userId),
            ),
          );
      });
      res.status(204).end();
    },
  );

  router.delete(
    '/organizations/:organizationId/members/:userId',
    async (req, res) => {
      const user = await requireUser(db, req);
      const organizationId = parseId(req.params.organizationId);
      const userId = parseId(req.params.userId);
      await db.transaction(async (tx) => {
        await lockOrganization(tx, organizationId);
        const actor = await membership(tx, organizationId, user.id);
        if (!actor)
          throw new HttpError(404, 'NOT_FOUND', 'Organization not found.');
        const target = await membership(tx, organizationId, userId);
        if (!target) throw new HttpError(404, 'NOT_FOUND', 'Member not found.');
        if (user.id !== userId) {
          requireManager(actor.role);
          if (actor.role === 'admin' && target.role !== 'member') {
            throw new HttpError(
              403,
              'FORBIDDEN',
              'Only owners can remove administrators or owners.',
            );
          }
        }
        await protectLastOwner(tx, organizationId, target.role);
        await tx
          .delete(memberships)
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.userId, userId),
            ),
          );
      });
      res.status(204).end();
    },
  );
  return router;
}
