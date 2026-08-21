import { describe, expect, it } from 'vitest';
import {
  LIGHTTABLE_DEFAULT_ACTION_SET_ID,
  SemanticActionLibrary,
  type SemanticActionLibraryStorage
} from './semanticActionLibrary';
import type { ActionRecordingSnapshot } from './semanticActionRecorder';
import type { ActionCommandContractEnvironment } from './actionCommandContracts';

const recording = (): ActionRecordingSnapshot => ({
  status: 'stopped', id: 'action-1', name: 'Untitled Action', startedAt: 1, stoppedAt: 2,
  byteLength: 4, limitReached: false, variables: [], steps: [{
    sequence: 1, requestId: 'request-1', origin: 'ui', command: 'layer.createRaster',
    contract: { status: 'complete', schemaVersion: 1 },
    documentId: 'old-document', parameters: {}, outcome: 'completed',
    result: { created: true, layerId: 'created' }, startedAt: 1, durationMs: 1, replayable: true,
    note: null, rationale: null
  }]
});
const memory = (initial: string | null = null) => {
  let value = initial;
  const storage: SemanticActionLibraryStorage = { read: () => value, write: (next) => { value = next; } };
  return { storage, value: () => value };
};

describe('semantic Action library', () => {
  it('persists, restores and deletes a bounded named Action', async () => {
    const state = memory(); const library = new SemanticActionLibrary(state.storage);
    expect((await library.save(recording(), 'Layer setup'))?.name).toBe('Layer setup');
    expect(JSON.parse(state.value()!)).toMatchObject({ version: 5,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set' }],
      actions: [{ setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID }] });
    expect(JSON.parse(state.value()!).actions[0].recording.steps[0].contract)
      .toEqual({ status: 'complete', schemaVersion: 1 });
    const restored = new SemanticActionLibrary(state.storage);
    expect(restored.snapshot()).toMatchObject({ selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
      selectedId: 'action-1',
      actions: [{ id: 'action-1', name: 'Layer setup' }] });
    expect(await restored.delete('action-1')).toBe(true);
    expect(new SemanticActionLibrary(state.storage).snapshot().actions).toHaveLength(0);
  });

  it('rejects incompatible or injected content atomically', () => {
    const incompatible = memory(JSON.stringify({
      format: 'lighttable-actions', version: 6, selectedId: null, actions: []
    }));
    expect(new SemanticActionLibrary(incompatible.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/unsupported/i)
    });
    const unsafe = recording();
    const injected = memory(JSON.stringify({ format: 'lighttable-actions', version: 1,
      selectedId: 'action-1', actions: [{ id: 'action-1', name: 'Injected', createdAt: 1,
        updatedAt: 2, recording: { ...unsafe, name: 'Injected',
          steps: [{ ...unsafe.steps[0], command: 'internal.replaceDocument' }] } }] }));
    expect(new SemanticActionLibrary(injected.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/incompatible workflow/i)
    });
  });

  it('migrates a version-1 Action to current per-step schema contracts and rewrites storage', async () => {
    const legacyRecording = { ...recording(), steps: [{
      ...recording().steps[0], command: 'layer.rename',
      parameters: { layerId: 'layer-1', name: 'Title' },
      result: { layerId: 'layer-1', name: 'Title' }
    }] };
    delete (legacyRecording.steps[0] as { contract?: unknown }).contract;
    const state = memory(JSON.stringify({ format: 'lighttable-actions', version: 1,
      selectedId: 'action-1', actions: [{ id: 'action-1', name: 'Legacy', createdAt: 1,
        updatedAt: 2, recording: { ...legacyRecording, name: 'Legacy' } }] }));
    const library = new SemanticActionLibrary(state.storage);
    await library.ready();

    expect(library.snapshot()).toMatchObject({ error: null, actions: [{ recording: { steps: [{
      command: 'layer.rename', contract: { status: 'complete', schemaVersion: 1 }
    }] } }] });
    expect(JSON.parse(state.value()!)).toMatchObject({ version: 5,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
      actions: [{ setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, recording: { steps: [{
        contract: { status: 'complete', schemaVersion: 1 }
      }] } }], sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID }]
    });
  });

  it('migrates a valid version-2 flat library into the Default Set atomically', async () => {
    const current = recording();
    const state = memory(JSON.stringify({ format: 'lighttable-actions', version: 2,
      selectedId: 'action-1', actions: [{ id: 'action-1', name: 'Version two', createdAt: 1,
        updatedAt: 2, recording: { ...current, name: 'Version two' } }] }));
    const library = new SemanticActionLibrary(state.storage);
    await library.ready();

    expect(library.snapshot()).toMatchObject({ selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
      selectedId: 'action-1', sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID }] });
    expect(JSON.parse(state.value()!)).toMatchObject({ version: 5,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
      actions: [{ setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID }]
    });
  });

  it('creates, renames, selects and deletes bounded Action Sets with their contained Actions', async () => {
    const state = memory();
    const library = new SemanticActionLibrary(state.storage);
    const portraits = await library.createSet(' Portraits ');
    expect(portraits).toMatchObject({ name: 'Portraits' });
    expect((await library.save(recording(), 'Portrait setup'))?.setId).toBe(portraits!.id);
    expect(await library.renameSet(portraits!.id, 'People')).toMatchObject({ name: 'People' });

    const products = await library.createSet('Products');
    expect(products).not.toBeNull();
    const productAction = await library.save(recording(), 'Product setup');
    expect(productAction).toMatchObject({ setId: products!.id, name: 'Product setup' });
    expect(productAction!.id).not.toBe('action-1');
    expect(await library.selectSet(portraits!.id)).toMatchObject({ name: 'People' });
    expect(library.snapshot()).toMatchObject({ selectedSetId: portraits!.id,
      selectedId: 'action-1' });

    expect(await library.deleteSet(portraits!.id)).toBe(true);
    expect(library.snapshot().sets.map(({ name }) => name)).toEqual(['Default Set', 'Products']);
    expect(library.snapshot().actions.map(({ name }) => name)).toEqual(['Product setup']);
    expect(await library.deleteSet(products!.id)).toBe(true);
    expect(await library.deleteSet(LIGHTTABLE_DEFAULT_ACTION_SET_ID)).toBe(false);
  });

  it('rejects malformed version-3 set relationships without retaining partial data', () => {
    const current = recording();
    const malformed = memory(JSON.stringify({ format: 'lighttable-actions', version: 3,
      selectedSetId: 'missing-set', selectedId: 'action-1',
      sets: [{ id: 'set-1', name: 'Valid', createdAt: 1, updatedAt: 1 }],
      actions: [{ id: 'action-1', setId: 'missing-set', name: 'Orphan', createdAt: 1,
        updatedAt: 2, recording: { ...current, name: 'Orphan' } }] }));

    expect(new SemanticActionLibrary(malformed.storage).snapshot()).toMatchObject({
      actions: [], sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID }],
      error: expect.stringMatching(/relationships/i)
    });
  });

  it('enforces the sixteen-set boundary', async () => {
    const library = new SemanticActionLibrary();
    for (let index = 1; index < 16; index += 1) {
      expect(await library.createSet(`Set ${index}`)).not.toBeNull();
    }
    expect(await library.createSet('Too many')).toBeNull();
    expect(library.snapshot().sets).toHaveLength(16);
  });

  it('rejects incompatible step schema versions and invalid legacy migration before playback', async () => {
    const current = recording();
    const future = memory(JSON.stringify({ format: 'lighttable-actions', version: 3,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: 'action-1',
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: 'Future', createdAt: 1,
        updatedAt: 2, recording: { ...current, name: 'Future', steps: [{ ...current.steps[0],
          command: 'layer.rename', contract: { status: 'complete', schemaVersion: 2 },
          parameters: { layerId: 'layer-1', name: 'Title' },
          result: { layerId: 'layer-1', name: 'Title' } }] } }] }));
    expect(new SemanticActionLibrary(future.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/schema v2.*supports v1/i)
    });

    const invalidLegacyStep = { ...current.steps[0], command: 'layer.rename',
      parameters: { layerId: 'layer-1' }, result: { layerId: 'layer-1', name: 'Title' } };
    delete (invalidLegacyStep as { contract?: unknown }).contract;
    const invalidLegacy = memory(JSON.stringify({ format: 'lighttable-actions', version: 1,
      selectedId: 'action-1', actions: [{ id: 'action-1', name: 'Invalid legacy', createdAt: 1,
        updatedAt: 2, recording: { ...current, name: 'Invalid legacy', steps: [invalidLegacyStep] } }] }));
    const library = new SemanticActionLibrary(invalidLegacy.storage);
    await library.ready();
    expect(library.snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/incompatible.*name is required/i)
    });
  });

  it('rejects malformed per-step contract markers instead of retaining private fields', () => {
    const current = recording();
    const malformed = memory(JSON.stringify({ format: 'lighttable-actions', version: 3,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: 'action-1',
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: 'Malformed', createdAt: 1,
        updatedAt: 2, recording: { ...current, name: 'Malformed', steps: [{ ...current.steps[0],
          contract: { status: 'legacy-properties-only', schemaVersion: null,
            privateRuntimeState: 'must-not-survive' } }] } }] }));

    expect(new SemanticActionLibrary(malformed.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/invalid command contract marker/i)
    });
  });

  it('migrates a version-3 Action to bounded variables and current storage atomically', async () => {
    const current = recording();
    const legacyRecording = { ...current } as Record<string, unknown>;
    delete legacyRecording.variables;
    const state = memory(JSON.stringify({ format: 'lighttable-actions', version: 3,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: 'action-1',
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: current.name, createdAt: 1, updatedAt: 2, recording: legacyRecording }] }));

    const library = new SemanticActionLibrary(state.storage);
    await library.ready();

    expect(library.snapshot().actions[0]?.recording.variables).toEqual([]);
    expect(JSON.parse(state.value()!)).toMatchObject({ version: 5,
      actions: [{ recording: { variables: [], steps: [{ rationale: null }] } }] });
  });

  it('rejects malformed version-4 variables without retaining the Action', () => {
    const current = recording();
    const malformed = memory(JSON.stringify({ format: 'lighttable-actions', version: 4,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: 'action-1',
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: current.name, createdAt: 1, updatedAt: 2,
        recording: { ...current, variables: [{ name: 'layer name', type: 'string', defaultValue: 'Title' }] } }] }));

    expect(new SemanticActionLibrary(malformed.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/variable name.*invalid/i)
    });
  });

  it('migrates version-4 steps to explicit bounded rationales and rewrites storage', async () => {
    const current = recording();
    const step = { ...current.steps[0] } as Record<string, unknown>;
    delete step.rationale;
    const state = memory(JSON.stringify({ format: 'lighttable-actions', version: 4,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: 'action-1',
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: current.name, createdAt: 1, updatedAt: 2,
        recording: { ...current, steps: [step] } }] }));

    const library = new SemanticActionLibrary(state.storage);
    await library.ready();

    expect(library.snapshot()).toMatchObject({ error: null,
      actions: [{ recording: { steps: [{ rationale: null }] } }] });
    expect(JSON.parse(state.value()!)).toMatchObject({ version: 5,
      actions: [{ recording: { steps: [{ rationale: null }] } }] });
  });

  it('atomically migrates a saved command contract and rewrites current storage', async () => {
    const current = recording();
    const oldStep = { ...current.steps[0]!, command: 'layer.rename',
      parameters: { layerId: 'layer-1', title: 'Title' },
      result: { renamedLayerId: 'layer-1', title: 'Title' } };
    const state = memory(JSON.stringify({ format: 'lighttable-actions', version: 5,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: 'action-1',
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: current.name, createdAt: 1, updatedAt: 2,
        recording: { ...current, steps: [oldStep] } }] }));
    const environment: ActionCommandContractEnvironment = { schemaVersion: 2, migrations: [{
      command: 'layer.rename', fromVersion: 1, toVersion: 2,
      migrate: ({ parameters, outcome, result }) => ({
        parameters: { layerId: (parameters as { layerId: string }).layerId,
          name: (parameters as { title: string }).title }, outcome,
        result: { layerId: (result as { renamedLayerId: string }).renamedLayerId,
          name: (result as { title: string }).title }
      })
    }] };

    const library = new SemanticActionLibrary(state.storage, environment);
    await library.ready();

    expect(library.snapshot()).toMatchObject({ error: null, actions: [{ recording: { steps: [{
      contract: { status: 'complete', schemaVersion: 2 },
      parameters: { layerId: 'layer-1', name: 'Title' },
      result: { layerId: 'layer-1', name: 'Title' }
    }] } }] });
    expect(JSON.parse(state.value()!)).toMatchObject({ version: 5, actions: [{ recording: { steps: [{
      contract: { status: 'complete', schemaVersion: 2 },
      parameters: { layerId: 'layer-1', name: 'Title' }
    }] } }] });
  });

  it('persists a bounded user-facing rationale in the current format', async () => {
    const state = memory();
    const library = new SemanticActionLibrary(state.storage);
    const current = recording();
    const explained = { ...current,
      steps: [{ ...current.steps[0]!, rationale: 'Names the reusable title layer.' }] };

    expect(await library.save(explained, 'Explained Action')).not.toBeNull();
    expect(JSON.parse(state.value()!)).toMatchObject({ version: 5,
      actions: [{ recording: { steps: [{ rationale: 'Names the reusable title layer.' }] } }] });
  });

  it.each([
    ['untrimmed rationale', { rationale: ' private whitespace ' }],
    ['oversized rationale', { rationale: 'x'.repeat(281) }],
    ['unknown private field', { privateModelReasoning: 'must-not-survive' }]
  ])('rejects a current-format step with %s atomically', (_label, injected) => {
    const current = recording();
    const malformed = memory(JSON.stringify({ format: 'lighttable-actions', version: 5,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: 'action-1',
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: current.name, createdAt: 1, updatedAt: 2,
        recording: { ...current, steps: [{ ...current.steps[0], ...injected }] } }] }));

    expect(new SemanticActionLibrary(malformed.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/steps are malformed/i)
    });
  });

  it('refuses diagnostic or partially replayable recordings', async () => {
    const library = new SemanticActionLibrary();
    expect(await library.save({ ...recording(), steps: [{ ...recording().steps[0]!, replayable: false }] },
      'Unsafe')).toBeNull();
    expect(library.snapshot().actions).toHaveLength(0);
  });
});
