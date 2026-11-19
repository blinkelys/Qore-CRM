import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  activeModules,
  enabledDependents,
  missingDependencies,
  moduleDefinitions,
  validateRegistry,
  type ModuleDefinition,
} from './registry.ts';

function module(key: string, dependencies: string[] = []): ModuleDefinition {
  return {
    ...moduleDefinitions[0],
    key,
    dependencies,
    settingsSchema: z.object({}),
    defaultSettings: {},
  };
}

describe('module registry', () => {
  it('rejects duplicate, missing, and cyclic dependencies', () => {
    expect(() => validateRegistry([module('one'), module('one')])).toThrow(
      'duplicate',
    );
    expect(() => validateRegistry([module('one', ['missing'])])).toThrow(
      'Unknown',
    );
    expect(() =>
      validateRegistry([module('one', ['two']), module('two', ['one'])]),
    ).toThrow('Cyclic');
  });

  it('requires entitled and enabled dependencies transitively', () => {
    const definitions = [
      module('base'),
      module('middle', ['base']),
      module('top', ['middle']),
    ];
    const enabled = new Set(['base', 'middle', 'top']);
    const allEntitled = new Set(['base', 'middle', 'top']);
    expect([...activeModules(definitions, allEntitled, enabled)]).toEqual([
      'base',
      'middle',
      'top',
    ]);
    const withoutBase = activeModules(
      definitions,
      new Set(['middle', 'top']),
      enabled,
    );
    expect(withoutBase.size).toBe(0);
    expect(missingDependencies(definitions[2], withoutBase)).toEqual([
      'middle',
    ]);
    expect(
      enabledDependents(definitions, 'base', enabled).map(
        (definition) => definition.key,
      ),
    ).toEqual(['middle']);
  });
});
