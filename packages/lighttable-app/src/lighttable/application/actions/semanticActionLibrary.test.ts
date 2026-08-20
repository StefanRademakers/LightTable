import { describe, expect, it } from 'vitest';
import { SemanticActionLibrary, type SemanticActionLibraryStorage } from './semanticActionLibrary';
import type { ActionRecordingSnapshot } from './semanticActionRecorder';

const recording = (): ActionRecordingSnapshot => ({
  status: 'stopped', id: 'action-1', name: 'Untitled Action', startedAt: 1, stoppedAt: 2,
  byteLength: 4, limitReached: false, steps: [{
    sequence: 1, requestId: 'request-1', origin: 'ui', command: 'layer.createRaster',
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
    const restored = new SemanticActionLibrary(state.storage);
    expect(restored.snapshot()).toMatchObject({ selectedId: 'action-1',
      actions: [{ id: 'action-1', name: 'Layer setup' }] });
    expect(await restored.delete('action-1')).toBe(true);
    expect(new SemanticActionLibrary(state.storage).snapshot().actions).toHaveLength(0);
  });

  it('rejects incompatible or injected content atomically', () => {
    const incompatible = memory(JSON.stringify({ format: 'lighttable-actions', version: 2, actions: [] }));
    expect(new SemanticActionLibrary(incompatible.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/unsupported/i)
    });
    const unsafe = recording();
    const injected = memory(JSON.stringify({ format: 'lighttable-actions', version: 1,
      selectedId: 'action-1', actions: [{ id: 'action-1', name: 'Injected', createdAt: 1,
        updatedAt: 2, recording: { ...unsafe, name: 'Injected',
          steps: [{ ...unsafe.steps[0], command: 'internal.replaceDocument' }] } }] }));
    expect(new SemanticActionLibrary(injected.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/invalid workflow/i)
    });
  });

  it('refuses diagnostic or partially replayable recordings', async () => {
    const library = new SemanticActionLibrary();
    expect(await library.save({ ...recording(), steps: [{ ...recording().steps[0]!, replayable: false }] },
      'Unsafe')).toBeNull();
    expect(library.snapshot().actions).toHaveLength(0);
  });
});
