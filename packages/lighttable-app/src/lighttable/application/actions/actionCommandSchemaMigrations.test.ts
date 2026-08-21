import { describe, expect, it } from 'vitest';
import {
  migrateActionCommandSteps,
  type ActionCommandSchemaMigration,
  type MigratableActionCommandStep
} from './actionCommandSchemaMigrations';

type Step = MigratableActionCommandStep & {
  readonly contract: { readonly status: 'complete'; readonly schemaVersion: number };
};

const step = (overrides: Partial<Step> = {}): Step => ({
  sequence: 1,
  command: 'layer.rename',
  parameters: { layerId: 'layer-1', title: 'Title' },
  outcome: 'completed',
  result: { renamedLayerId: 'layer-1', title: 'Title' },
  contract: { status: 'complete', schemaVersion: 1 },
  ...overrides
});

const renameV1ToV2: ActionCommandSchemaMigration = {
  command: 'layer.rename', fromVersion: 1, toVersion: 2,
  migrate: ({ parameters, outcome, result }) => ({
    parameters: { layerId: (parameters as { layerId: string }).layerId,
      name: (parameters as { title: string }).title },
    outcome,
    result: { layerId: (result as { renamedLayerId: string }).renamedLayerId,
      name: (result as { title: string }).title },
    resultPathRenames: { renamedLayerId: 'layerId', title: 'name' }
  })
};

describe('Action command-schema migrations', () => {
  it('migrates parameters/results and rewrites exact downstream result bindings', () => {
    const dependent = step({ sequence: 2, command: 'layer.setVisibility',
      parameters: { layerIds: [{ $lighttableResult: { step: 1, path: 'renamedLayerId' } }], visible: true },
      result: { layerIds: ['layer-1'], visible: true } });
    const migrated = migrateActionCommandSteps([step(), dependent], 2, [renameV1ToV2, {
      command: 'layer.setVisibility', fromVersion: 1, toVersion: 2,
      migrate: (value) => value
    }]);

    expect(migrated).toMatchObject({ ok: true, migrated: true, steps: [
      { parameters: { layerId: 'layer-1', name: 'Title' },
        result: { layerId: 'layer-1', name: 'Title' }, contract: { schemaVersion: 2 } },
      { parameters: { layerIds: [{ $lighttableResult: { step: 1, path: 'layerId' } }], visible: true },
        contract: { schemaVersion: 2 } }
    ] });
  });

  it('requires and applies every consecutive migration in a chain', () => {
    const migrated = migrateActionCommandSteps([step()], 3, [renameV1ToV2, {
      command: 'layer.rename', fromVersion: 2, toVersion: 3,
      migrate: ({ parameters, outcome, result }) => ({ parameters: { ...parameters as object, trim: true },
        outcome, result })
    }]);
    expect(migrated).toMatchObject({ ok: true, steps: [{
      parameters: { layerId: 'layer-1', name: 'Title', trim: true },
      contract: { schemaVersion: 3 }
    }] });
  });

  it('rejects future versions and missing migration links', () => {
    expect(migrateActionCommandSteps([step({ contract: { status: 'complete', schemaVersion: 3 } })], 2, []))
      .toMatchObject({ ok: false, sequence: 1, message: expect.stringMatching(/v3.*supports v2/i) });
    expect(migrateActionCommandSteps([step()], 2, []))
      .toMatchObject({ ok: false, sequence: 1, message: expect.stringMatching(/explicit schema v1 to v2/i) });
  });

  it.each([
    ['duplicate', [renameV1ToV2, renameV1ToV2], /duplicates layer\.rename v1/i],
    ['non-consecutive', [{ ...renameV1ToV2, toVersion: 3 }], /invalid or non-consecutive/i]
  ])('rejects an invalid %s registry before migration', (_label, migrations, message) => {
    expect(migrateActionCommandSteps([step()], 2, migrations as ActionCommandSchemaMigration[]))
      .toMatchObject({ ok: false, sequence: 0, message: expect.stringMatching(message) });
  });

  it('contains thrown, malformed and unclonable migration output', () => {
    const migration = (migrate: ActionCommandSchemaMigration['migrate']): ActionCommandSchemaMigration => ({
      command: 'layer.rename', fromVersion: 1, toVersion: 2, migrate
    });
    expect(migrateActionCommandSteps([step()], 2, [migration(() => { throw new Error('broken'); })]))
      .toMatchObject({ ok: false, sequence: 1, message: expect.stringMatching(/failed: broken/i) });
    expect(migrateActionCommandSteps([step()], 2, [migration(() => ({
      parameters: {}, outcome: 'changed', result: {}
    }))])).toMatchObject({ ok: false, sequence: 1, message: expect.stringMatching(/invalid data/i) });
    expect(migrateActionCommandSteps([step()], 2, [migration(({ outcome }) => ({
      parameters: { callback: () => undefined }, outcome, result: {}
    }))])).toMatchObject({ ok: false, sequence: 1, message: expect.stringMatching(/unclonable data/i) });
  });

  it('rejects malformed result-path rewrites', () => {
    expect(migrateActionCommandSteps([step()], 2, [{ ...renameV1ToV2,
      migrate: (value) => ({ ...renameV1ToV2.migrate(value), resultPathRenames: { old: '' } })
    }])).toMatchObject({ ok: false, sequence: 1, message: expect.stringMatching(/invalid data/i) });
  });
});
