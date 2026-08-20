import { describe, expect, it } from 'vitest';
import { SemanticActionLibrary, type SemanticActionLibraryStorage } from './semanticActionLibrary';
import type { ActionRecordingSnapshot } from './semanticActionRecorder';

const recording = (): ActionRecordingSnapshot => ({
  status: 'stopped', id: 'action-1', name: 'Untitled Action', startedAt: 1, stoppedAt: 2,
  byteLength: 4, limitReached: false, steps: [{
    sequence: 1, requestId: 'request-1', origin: 'ui', command: 'layer.createRaster',
    contract: { status: 'legacy-properties-only', schemaVersion: null },
    documentId: 'old-document', parameters: {}, outcome: 'completed',
    result: { layerId: 'created' }, startedAt: 1, durationMs: 1, replayable: true, note: null
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
    expect(JSON.parse(state.value()!).version).toBe(2);
    expect(JSON.parse(state.value()!).actions[0].recording.steps[0].contract)
      .toEqual({ status: 'legacy-properties-only', schemaVersion: null });
    const restored = new SemanticActionLibrary(state.storage);
    expect(restored.snapshot()).toMatchObject({ selectedId: 'action-1',
      actions: [{ id: 'action-1', name: 'Layer setup' }] });
    expect(await restored.delete('action-1')).toBe(true);
    expect(new SemanticActionLibrary(state.storage).snapshot().actions).toHaveLength(0);
  });

  it('rejects incompatible or injected content atomically', () => {
    const incompatible = memory(JSON.stringify({
      format: 'lighttable-actions', version: 3, selectedId: null, actions: []
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
    expect(JSON.parse(state.value()!)).toMatchObject({ version: 2, actions: [{ recording: { steps: [{
      contract: { status: 'complete', schemaVersion: 1 }
    }] } }] });
  });

  it('rejects incompatible step schema versions and invalid legacy migration before playback', async () => {
    const current = recording();
    const future = memory(JSON.stringify({ format: 'lighttable-actions', version: 2,
      selectedId: 'action-1', actions: [{ id: 'action-1', name: 'Future', createdAt: 1,
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
    const malformed = memory(JSON.stringify({ format: 'lighttable-actions', version: 2,
      selectedId: 'action-1', actions: [{ id: 'action-1', name: 'Malformed', createdAt: 1,
        updatedAt: 2, recording: { ...current, name: 'Malformed', steps: [{ ...current.steps[0],
          contract: { status: 'legacy-properties-only', schemaVersion: null,
            privateRuntimeState: 'must-not-survive' } }] } }] }));

    expect(new SemanticActionLibrary(malformed.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/invalid command contract marker/i)
    });
  });

  it('refuses diagnostic or partially replayable recordings', async () => {
    const library = new SemanticActionLibrary();
    expect(await library.save({ ...recording(), steps: [{ ...recording().steps[0]!, replayable: false }] },
      'Unsafe')).toBeNull();
    expect(library.snapshot().actions).toHaveLength(0);
  });
});
