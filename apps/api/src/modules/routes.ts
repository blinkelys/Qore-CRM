import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { parseBody, requireUser } from '../auth/routes.ts';
import { moduleEntitlements, organizationModules } from '../db/schema.ts';
import { HttpError } from '../http.ts';
import {
  lockOrganization,
  membership,
  parseId,
  type Database,
  type Transaction,
} from '../organizations/access.ts';
import {
  activeModules,
  enabledDependents,
  missingDependencies,
  moduleDefinitions,
  moduleRegistry,
  type ModuleDefinition,
  type ModuleRole,
} from './registry.ts';

async function actorFor(
  tx: Transaction,
  organizationId: string,
  userId: string,
) {
  await lockOrganization(tx, organizationId);
  const actor = await membership(tx, organizationId, userId);
  if (!actor) throw new HttpError(404, 'NOT_FOUND', 'Organization not found.');
  return actor;
}

function definitionFor(key: string) {
  const definition = moduleRegistry.get(key);
  if (!definition) throw new HttpError(404, 'NOT_FOUND', 'Module not found.');
  return definition;
}

function requirePermission(
  definition: ModuleDefinition,
  role: ModuleRole,
  permission: 'read' | 'manage',
) {
  if (!definition.permissions[permission].includes(role)) {
    throw new HttpError(
      403,
      'FORBIDDEN',
      'You do not have permission to manage this module.',
    );
  }
}

async function moduleState(
  tx: Transaction,
  organizationId: string,
  key: string,
) {
  const [entitlement] = await tx
    .select()
    .from(moduleEntitlements)
    .where(
      and(
        eq(moduleEntitlements.organizationId, organizationId),
        eq(moduleEntitlements.moduleKey, key),
      ),
    );
  const [state] = await tx
    .select()
    .from(organizationModules)
    .where(
      and(
        eq(organizationModules.organizationId, organizationId),
        eq(organizationModules.moduleKey, key),
      ),
    );
  return { entitlement, state };
}

function settingsFor(
  definition: ModuleDefinition,
  state: typeof organizationModules.$inferSelect,
) {
  if (state.settingsVersion !== definition.version) {
    throw new HttpError(
      409,
      'MODULE_MIGRATION_REQUIRED',
      'This module requires a settings migration.',
    );
  }
  const parsed = definition.settingsSchema.safeParse(state.settings);
  if (!parsed.success) throw new Error('Stored module settings are invalid');
  return parsed.data;
}

export async function requireEnabled(
  tx: Transaction,
  organizationId: string,
  userId: string,
  key: string,
  permission: 'read' | 'manage',
) {
  const actor = await actorFor(tx, organizationId, userId);
  const definition = definitionFor(key);
  requirePermission(definition, actor.role, permission);
  const { entitlement, state } = await moduleState(tx, organizationId, key);
  if (!entitlement || !state?.enabled) {
    throw new HttpError(
      404,
      'MODULE_UNAVAILABLE',
      'This module is unavailable.',
    );
  }
  const entitlements = await tx
    .select()
    .from(moduleEntitlements)
    .where(eq(moduleEntitlements.organizationId, organizationId));
  const states = await tx
    .select()
    .from(organizationModules)
    .where(eq(organizationModules.organizationId, organizationId));
  const active = activeModules(
    moduleDefinitions,
    new Set(entitlements.map((entry) => entry.moduleKey)),
    new Set(
      states.filter((entry) => entry.enabled).map((entry) => entry.moduleKey),
    ),
  );
  if (!active.has(key))
    throw new HttpError(
      404,
      'MODULE_UNAVAILABLE',
      'This module is unavailable.',
    );
  const settings = settingsFor(definition, state);
  return { definition, state, settings };
}

export function createModuleRouter(db: Database) {
  const router = Router();

  router.get('/organizations/:organizationId/modules', async (req, res) => {
    const user = await requireUser(db, req);
    const organizationId = parseId(req.params.organizationId);
    const modules = await db.transaction(async (tx) => {
      await actorFor(tx, organizationId, user.id);
      const entitlements = await tx
        .select()
        .from(moduleEntitlements)
        .where(eq(moduleEntitlements.organizationId, organizationId));
      const states = await tx
        .select()
        .from(organizationModules)
        .where(eq(organizationModules.organizationId, organizationId));
      const entitled = new Set(entitlements.map((entry) => entry.moduleKey));
      const enabled = new Set(
        states.filter((entry) => entry.enabled).map((entry) => entry.moduleKey),
      );
      const active = activeModules(moduleDefinitions, entitled, enabled);
      return moduleDefinitions.map((definition) => ({
        key: definition.key,
        name: definition.name,
        description: definition.description,
        version: definition.version,
        dependencies: definition.dependencies,
        permissions: definition.permissions,
        navigation: definition.navigation,
        apiRoute: definition.apiRoute,
        enabled: enabled.has(definition.key),
        status:
          !entitled.has(definition.key) ||
          (enabled.has(definition.key) && !active.has(definition.key))
            ? 'unavailable'
            : enabled.has(definition.key)
              ? 'enabled'
              : 'available',
      }));
    });
    res.json({ modules });
  });

  router.put(
    '/organizations/:organizationId/modules/:key/enabled',
    async (req, res) => {
      const user = await requireUser(db, req);
      const organizationId = parseId(req.params.organizationId);
      const key = req.params.key;
      const { enabled } = parseBody(
        z.object({ enabled: z.boolean() }).strict(),
        req.body,
      );
      await db.transaction(async (tx) => {
        const actor = await actorFor(tx, organizationId, user.id);
        const definition = definitionFor(key);
        requirePermission(definition, actor.role, 'manage');
        const { entitlement, state } = await moduleState(
          tx,
          organizationId,
          key,
        );
        if (!entitlement)
          throw new HttpError(
            404,
            'MODULE_UNAVAILABLE',
            'This module is unavailable.',
          );
        const allStates = await tx
          .select()
          .from(organizationModules)
          .where(eq(organizationModules.organizationId, organizationId));
        if (enabled) {
          const entitlements = await tx
            .select()
            .from(moduleEntitlements)
            .where(eq(moduleEntitlements.organizationId, organizationId));
          const entitled = new Set(
            entitlements.map((entry) => entry.moduleKey),
          );
          const active = activeModules(
            moduleDefinitions,
            entitled,
            new Set(
              allStates
                .filter((entry) => entry.enabled)
                .map((entry) => entry.moduleKey),
            ),
          );
          if (missingDependencies(definition, active).length) {
            throw new HttpError(
              409,
              'MODULE_DEPENDENCY_REQUIRED',
              'Enable the required modules first.',
            );
          }
          if (state) settingsFor(definition, state);
          await tx
            .insert(organizationModules)
            .values({
              organizationId,
              moduleKey: key,
              enabled: true,
              settings: definition.defaultSettings,
              settingsVersion: definition.version,
            })
            .onConflictDoUpdate({
              target: [
                organizationModules.organizationId,
                organizationModules.moduleKey,
              ],
              set: { enabled: true },
            });
        } else {
          const active = new Set(
            allStates
              .filter((entry) => entry.enabled)
              .map((entry) => entry.moduleKey),
          );
          if (enabledDependents(moduleDefinitions, key, active).length) {
            throw new HttpError(
              409,
              'MODULE_HAS_DEPENDENTS',
              'Disable dependent modules first.',
            );
          }
          if (state)
            await tx
              .update(organizationModules)
              .set({ enabled: false })
              .where(
                and(
                  eq(organizationModules.organizationId, organizationId),
                  eq(organizationModules.moduleKey, key),
                ),
              );
        }
      });
      res.status(204).end();
    },
  );

  router.get(
    '/organizations/:organizationId/modules/:key/settings',
    async (req, res) => {
      const user = await requireUser(db, req);
      const organizationId = parseId(req.params.organizationId);
      const result = await db.transaction((tx) =>
        requireEnabled(tx, organizationId, user.id, req.params.key, 'read'),
      );
      res.json({
        settings: result.settings,
        version: result.state.settingsVersion,
      });
    },
  );

  router.put(
    '/organizations/:organizationId/modules/:key/settings',
    async (req, res) => {
      const user = await requireUser(db, req);
      const organizationId = parseId(req.params.organizationId);
      const settings = await db.transaction(async (tx) => {
        const { definition } = await requireEnabled(
          tx,
          organizationId,
          user.id,
          req.params.key,
          'manage',
        );
        const parsed = definition.settingsSchema.safeParse(req.body);
        if (!parsed.success)
          throw new HttpError(
            400,
            'INVALID_INPUT',
            'Please check the module settings.',
          );
        await tx
          .update(organizationModules)
          .set({ settings: parsed.data })
          .where(
            and(
              eq(organizationModules.organizationId, organizationId),
              eq(organizationModules.moduleKey, definition.key),
            ),
          );
        return parsed.data;
      });
      res.json({ settings });
    },
  );
  return router;
}
