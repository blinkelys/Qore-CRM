import { z } from 'zod';
import { websiteSchema } from '../website.ts';

export type ModuleRole = 'owner' | 'admin' | 'member';
export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  version: number;
  dependencies: readonly string[];
  permissions: { read: readonly ModuleRole[]; manage: readonly ModuleRole[] };
  navigation: { label: string; anchor: string };
  apiRoute: string;
  settingsSchema: z.ZodType;
  defaultSettings: unknown;
}

export function validateRegistry(definitions: readonly ModuleDefinition[]) {
  const byKey = new Map<string, ModuleDefinition>();
  for (const definition of definitions) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(definition.key) ||
      byKey.has(definition.key)
    ) {
      throw new Error(`Invalid or duplicate module key: ${definition.key}`);
    }
    if (
      !Number.isInteger(definition.version) ||
      definition.version < 1 ||
      !definition.settingsSchema.safeParse(definition.defaultSettings).success
    ) {
      throw new Error(`Invalid module configuration: ${definition.key}`);
    }
    byKey.set(definition.key, definition);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string) {
    if (visiting.has(key)) throw new Error(`Cyclic module dependency: ${key}`);
    if (visited.has(key)) return;
    const definition = byKey.get(key);
    if (!definition) throw new Error(`Unknown module dependency: ${key}`);
    visiting.add(key);
    for (const dependency of definition.dependencies) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of byKey.keys()) visit(key);
  return byKey;
}

export function missingDependencies(
  definition: ModuleDefinition,
  enabled: ReadonlySet<string>,
) {
  return definition.dependencies.filter((key) => !enabled.has(key));
}

export function activeModules(
  definitions: readonly ModuleDefinition[],
  entitled: ReadonlySet<string>,
  enabled: ReadonlySet<string>,
) {
  const registry = validateRegistry(definitions);
  const active = new Set<string>();
  function isActive(key: string): boolean {
    if (active.has(key)) return true;
    const definition = registry.get(key);
    if (!definition || !entitled.has(key) || !enabled.has(key)) return false;
    if (!definition.dependencies.every(isActive)) return false;
    active.add(key);
    return true;
  }
  for (const definition of definitions) isActive(definition.key);
  return active;
}

export function enabledDependents(
  definitions: readonly ModuleDefinition[],
  key: string,
  enabled: ReadonlySet<string>,
) {
  return definitions.filter(
    (definition) =>
      enabled.has(definition.key) && definition.dependencies.includes(key),
  );
}

export const moduleDefinitions: readonly ModuleDefinition[] = [
  {
    key: 'organization-profile',
    name: 'Organization profile',
    description:
      'Share an organization description and website with its members.',
    version: 1,
    dependencies: [],
    permissions: {
      read: ['owner', 'admin', 'member'],
      manage: ['owner', 'admin'],
    },
    navigation: {
      label: 'Organization profile',
      anchor: '#module-organization-profile',
    },
    apiRoute:
      '/organizations/:organizationId/modules/organization-profile/settings',
    settingsSchema: z
      .object({ description: z.string().max(500), website: websiteSchema })
      .strict(),
    defaultSettings: { description: '', website: '' },
  },
  {
    key: 'contacts',
    name: 'Contacts',
    description: 'Manage and find contacts in your organization.',
    version: 1,
    dependencies: [],
    permissions: {
      read: ['owner', 'admin', 'member'],
      manage: ['owner', 'admin'],
    },
    navigation: { label: 'Contacts', anchor: '#module-contacts' },
    apiRoute: '/organizations/:organizationId/contacts',
    settingsSchema: z.object({}).strict(),
    defaultSettings: {},
  },
  {
    key: 'companies',
    name: 'Companies',
    description: 'Manage companies and link them to contacts.',
    version: 1,
    dependencies: [],
    permissions: {
      read: ['owner', 'admin', 'member'],
      manage: ['owner', 'admin'],
    },
    navigation: { label: 'Companies', anchor: '#module-companies' },
    apiRoute: '/organizations/:organizationId/companies',
    settingsSchema: z.object({}).strict(),
    defaultSettings: {},
  },
  {
    key: 'timeline',
    name: 'Notes and activities',
    description: 'Record notes and activities on contacts and companies.',
    version: 1,
    dependencies: [],
    permissions: {
      read: ['owner', 'admin', 'member'],
      manage: ['owner', 'admin'],
    },
    navigation: { label: 'Notes and activities', anchor: '#module-timeline' },
    apiRoute: '/organizations/:organizationId/:recordType/:recordId/timeline',
    settingsSchema: z.object({}).strict(),
    defaultSettings: {},
  },
];

export const moduleRegistry = validateRegistry(moduleDefinitions);
