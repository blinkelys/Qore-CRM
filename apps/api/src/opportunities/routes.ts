import { and, asc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { parseBody, requireUser } from '../auth/routes.ts';
import { opportunities, pipelineStages } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import { requireEnabled } from '../modules/routes.ts';
import {
  parseId,
  type Database,
  type Transaction,
} from '../organizations/access.ts';
import { checkRecordVersion, recordPageSize, recordQuery } from '../records.ts';

const nameSchema = z.string().trim().min(1).max(100);
const stageFields = z.object({ name: nameSchema }).strict();
const editStageFields = stageFields.safeExtend({
  version: z.number().int().positive(),
});
const archiveFields = z
  .object({ version: z.number().int().positive(), archived: z.boolean() })
  .strict();
const moveFields = z
  .object({
    version: z.number().int().positive(),
    direction: z.enum(['up', 'down']),
  })
  .strict();
const versionFields = z
  .object({ version: z.number().int().positive() })
  .strict();
const opportunityFields = z
  .object({
    name: nameSchema,
    stageId: z.uuid(),
    amount: z.union([
      z.literal(''),
      z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/),
    ]),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.union([z.literal(''), z.string().regex(/^[A-Z]{3}$/)])),
  })
  .strict()
  .refine((value) => Boolean(value.amount) === Boolean(value.currency));
const editOpportunityFields = opportunityFields.safeExtend({
  version: z.number().int().positive(),
});
const queryFields = recordQuery.safeExtend({ stageId: z.uuid().optional() });

async function findStage(tx: Transaction, organizationId: string, id: string) {
  const [stage] = await tx
    .select()
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.organizationId, organizationId),
        eq(pipelineStages.id, id),
      ),
    );
  if (!stage) throw new HttpError(404, 'NOT_FOUND', 'Stage not found.');
  return stage;
}

async function findOpportunity(
  tx: Transaction,
  organizationId: string,
  id: string,
) {
  const [opportunity] = await tx
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, id),
      ),
    );
  if (!opportunity)
    throw new HttpError(404, 'NOT_FOUND', 'Opportunity not found.');
  return opportunity;
}

async function ensureUniqueStageName(
  tx: Transaction,
  organizationId: string,
  name: string,
  id?: string,
) {
  const [existing] = await tx
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.organizationId, organizationId),
        sql`lower(${pipelineStages.name}) = lower(${name})`,
        id ? ne(pipelineStages.id, id) : undefined,
      ),
    )
    .limit(1);
  if (existing)
    throw new HttpError(
      409,
      'STAGE_NAME_IN_USE',
      'A stage already uses this name, including inactive stages.',
    );
}

function requireActiveStage(stage: typeof pipelineStages.$inferSelect) {
  if (stage.archivedAt)
    throw new HttpError(409, 'STAGE_INACTIVE', 'Choose an active stage first.');
}

export function createOpportunitiesRouter(db: Database) {
  const router = Router();
  const path = '/organizations/:organizationId/opportunities';

  router.get(`${path}/stages`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const stages = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'read',
      );
      return tx
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.organizationId, organizationId))
        .orderBy(asc(pipelineStages.position), asc(pipelineStages.id));
    });
    res.json({ stages });
  });

  router.post(`${path}/stages`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const { name } = parseBody(stageFields, req.body);
    const stage = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'manage',
      );
      await ensureUniqueStageName(tx, organizationId, name);
      const current = await tx
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.organizationId, organizationId));
      if (current.length >= 50)
        throw new HttpError(
          409,
          'STAGE_LIMIT',
          'A pipeline can have at most 50 stages.',
        );
      const position =
        current.reduce((max, item) => Math.max(max, item.position), -1) + 1;
      const [created] = await tx
        .insert(pipelineStages)
        .values({ organizationId, name, position })
        .returning();
      return created;
    });
    res.status(201).json({ stage });
  });

  router.put(`${path}/stages/:stageId`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.stageId);
    const { name, version } = parseBody(editStageFields, req.body);
    const stage = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'manage',
      );
      const current = await findStage(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Stage');
      await ensureUniqueStageName(tx, organizationId, name, id);
      const [updated] = await tx
        .update(pipelineStages)
        .set({ name, version: version + 1 })
        .where(
          and(
            eq(pipelineStages.organizationId, organizationId),
            eq(pipelineStages.id, id),
          ),
        )
        .returning();
      return updated;
    });
    res.json({ stage });
  });

  router.put(`${path}/stages/:stageId/move`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.stageId);
    const { direction, version } = parseBody(moveFields, req.body);
    await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'manage',
      );
      const current = await findStage(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Stage');
      const stages = await tx
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.organizationId, organizationId))
        .orderBy(asc(pipelineStages.position), asc(pipelineStages.id));
      const index = stages.findIndex((stage) => stage.id === id);
      const neighbor = stages[index + (direction === 'up' ? -1 : 1)];
      if (!neighbor) return;
      await tx
        .update(pipelineStages)
        .set({ position: neighbor.position, version: current.version + 1 })
        .where(
          and(
            eq(pipelineStages.organizationId, organizationId),
            eq(pipelineStages.id, id),
          ),
        );
      await tx
        .update(pipelineStages)
        .set({ position: current.position, version: neighbor.version + 1 })
        .where(
          and(
            eq(pipelineStages.organizationId, organizationId),
            eq(pipelineStages.id, neighbor.id),
          ),
        );
    });
    res.status(204).end();
  });

  router.put(`${path}/stages/:stageId/archive`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.stageId);
    const { version, archived } = parseBody(archiveFields, req.body);
    const stage = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'manage',
      );
      const current = await findStage(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Stage');
      if (Boolean(current.archivedAt) === archived) return current;
      if (archived) {
        const [active] = await tx
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.organizationId, organizationId),
              eq(opportunities.stageId, id),
              isNull(opportunities.archivedAt),
            ),
          )
          .limit(1);
        if (active)
          throw new HttpError(
            409,
            'STAGE_HAS_OPPORTUNITIES',
            'Move or archive active opportunities before deactivating this stage.',
          );
      }
      const [updated] = await tx
        .update(pipelineStages)
        .set({ archivedAt: archived ? new Date() : null, version: version + 1 })
        .where(
          and(
            eq(pipelineStages.organizationId, organizationId),
            eq(pipelineStages.id, id),
          ),
        )
        .returning();
      return updated;
    });
    res.json({ stage });
  });

  router.delete(`${path}/stages/:stageId`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.stageId);
    const { version } = parseBody(versionFields, req.body);
    await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'manage',
      );
      const current = await findStage(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Stage');
      const [existing] = await tx
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.organizationId, organizationId),
            eq(opportunities.stageId, id),
          ),
        )
        .limit(1);
      if (existing)
        throw new HttpError(
          409,
          'STAGE_HAS_HISTORY',
          'A stage with opportunities cannot be deleted.',
        );
      await tx
        .delete(pipelineStages)
        .where(
          and(
            eq(pipelineStages.organizationId, organizationId),
            eq(pipelineStages.id, id),
          ),
        );
    });
    res.status(204).end();
  });

  router.get(path, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const query = parseBody(queryFields, req.query);
    const result = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'read',
      );
      if (query.stageId) await findStage(tx, organizationId, query.stageId);
      const where = and(
        eq(opportunities.organizationId, organizationId),
        query.stageId ? eq(opportunities.stageId, query.stageId) : undefined,
        query.status === 'active'
          ? isNull(opportunities.archivedAt)
          : query.status === 'archived'
            ? isNotNull(opportunities.archivedAt)
            : undefined,
        query.q
          ? sql`position(lower(${query.q}) in lower(${opportunities.name})) > 0`
          : undefined,
      );
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(opportunities)
        .where(where);
      const items = await tx
        .select({ opportunity: opportunities })
        .from(opportunities)
        .innerJoin(
          pipelineStages,
          and(
            eq(pipelineStages.organizationId, opportunities.organizationId),
            eq(pipelineStages.id, opportunities.stageId),
          ),
        )
        .where(where)
        .orderBy(
          asc(pipelineStages.position),
          asc(opportunities.name),
          asc(opportunities.id),
        )
        .limit(recordPageSize)
        .offset((query.page - 1) * recordPageSize);
      return {
        opportunities: items.map((item) => item.opportunity),
        total: count.total,
        page: query.page,
        pageSize: recordPageSize,
      };
    });
    res.json(result);
  });

  router.get(`${path}/:opportunityId`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.opportunityId);
    const opportunity = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'read',
      );
      return findOpportunity(tx, organizationId, id);
    });
    res.json({ opportunity });
  });

  router.post(path, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const data = parseBody(opportunityFields, req.body);
    const opportunity = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'read',
      );
      requireActiveStage(await findStage(tx, organizationId, data.stageId));
      const [created] = await tx
        .insert(opportunities)
        .values({
          ...data,
          organizationId,
          amount: data.amount || null,
          currency: data.currency || null,
        })
        .returning();
      return created;
    });
    res.status(201).json({ opportunity });
  });

  router.put(`${path}/:opportunityId`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.opportunityId);
    const { version, ...data } = parseBody(editOpportunityFields, req.body);
    const opportunity = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'read',
      );
      const current = await findOpportunity(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Opportunity');
      const stage = await findStage(tx, organizationId, data.stageId);
      if (stage.id !== current.stageId || !current.archivedAt)
        requireActiveStage(stage);
      const [updated] = await tx
        .update(opportunities)
        .set({
          ...data,
          amount: data.amount || null,
          currency: data.currency || null,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(opportunities.organizationId, organizationId),
            eq(opportunities.id, id),
          ),
        )
        .returning();
      return updated;
    });
    res.json({ opportunity });
  });

  router.put(`${path}/:opportunityId/archive`, async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const id = parseId(req.params.opportunityId);
    const { version, archived } = parseBody(archiveFields, req.body);
    const opportunity = await db.transaction(async (tx) => {
      await requireEnabled(
        tx,
        organizationId,
        user.id,
        'opportunities',
        'read',
      );
      const current = await findOpportunity(tx, organizationId, id);
      checkRecordVersion(current.version, version, 'Opportunity');
      if (Boolean(current.archivedAt) === archived) return current;
      if (!archived)
        requireActiveStage(
          await findStage(tx, organizationId, current.stageId),
        );
      const [updated] = await tx
        .update(opportunities)
        .set({
          archivedAt: archived ? new Date() : null,
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(opportunities.organizationId, organizationId),
            eq(opportunities.id, id),
          ),
        )
        .returning();
      return updated;
    });
    res.json({ opportunity });
  });
  return router;
}
