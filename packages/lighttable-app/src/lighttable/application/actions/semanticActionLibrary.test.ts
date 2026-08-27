import { describe, expect, it, vi } from 'vitest';
import {
  LIGHTTABLE_DEFAULT_ACTION_SET_ID,
  SemanticActionLibrary,
  type SemanticActionLibraryStorage
} from './semanticActionLibrary';
import type { ActionRecordingSnapshot } from './semanticActionRecorder';

const recording = (): ActionRecordingSnapshot => ({
  status: 'stopped', id: 'action-1', name: 'Untitled Action', startedAt: 1, stoppedAt: 2,
  byteLength: 4, limitReached: false, variables: [], steps: [{
    sequence: 1, requestId: 'request-1', origin: 'ui', command: 'layer.createRaster',
    contract: { status: 'complete', schemaVersion: 1 }, documentId: 'old-document',
    parameters: {}, outcome: 'completed', result: { created: true, layerId: 'created' },
    startedAt: 1, durationMs: 1, replayable: true, note: null, rationale: null
  }]
});

const memory = (initial: string | null = null) => {
  let value = initial;
  const storage: SemanticActionLibraryStorage = {
    read: () => value, write: (next) => { value = next; }
  };
  return { storage, value: () => value };
};

describe('semantic Action library', () => {
  it('persists, restores and deletes a named Action in the current alpha format', async () => {
    const state = memory();
    const library = new SemanticActionLibrary(state.storage);
    expect((await library.save(recording(), 'Layer setup'))?.name).toBe('Layer setup');
    expect(JSON.parse(state.value()!)).toMatchObject({
      format: 'lighttable-actions', selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set' }],
      actions: [{ setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID }]
    });
    expect(JSON.parse(state.value()!)).not.toHaveProperty('version');
    const restored = new SemanticActionLibrary(state.storage);
    expect(restored.snapshot()).toMatchObject({ selectedId: 'action-1',
      actions: [{ id: 'action-1', name: 'Layer setup' }] });
    expect(await restored.delete('action-1')).toBe(true);
    expect(new SemanticActionLibrary(state.storage).snapshot().actions).toHaveLength(0);
  });

  it('creates, renames, selects and deletes Action Sets with their Actions', async () => {
    const library = new SemanticActionLibrary();
    const portraits = await library.createSet(' Portraits ');
    expect(portraits).toMatchObject({ name: 'Portraits', enabled: true });
    expect(await library.setSetEnabled(portraits!.id, false)).toEqual([]);
    expect(library.snapshot().sets.find(({ id }) => id === portraits!.id)?.enabled).toBe(false);
    expect(await library.setSetEnabled(portraits!.id, true)).toEqual([]);
    expect((await library.save(recording(), 'Portrait setup'))?.setId).toBe(portraits!.id);
    expect(await library.renameSet(portraits!.id, 'People')).toMatchObject({ name: 'People' });
    const products = await library.createSet('Products');
    expect(await library.save(recording(), 'Product setup')).toMatchObject({ setId: products!.id });
    expect(await library.selectSet(portraits!.id)).toMatchObject({ name: 'People' });
    expect(await library.deleteSet(portraits!.id)).toBe(true);
    expect(library.snapshot().actions.map(({ name }) => name)).toEqual(['Product setup']);
  });

  it('enforces the Action Set boundary', async () => {
    const library = new SemanticActionLibrary();
    for (let index = 1; index < 16; index += 1) {
      expect(await library.createSet(`Set ${index}`)).not.toBeNull();
    }
    expect(await library.createSet('Too many')).toBeNull();
  });

  it('rejects malformed relationships and command contracts atomically', () => {
    const current = recording();
    const state = memory(JSON.stringify({
      format: 'lighttable-actions', selectedSetId: 'missing', selectedId: 'action-1',
      sets: [{ id: 'set-1', name: 'Set', createdAt: 1, updatedAt: 1 }],
      actions: [{ id: 'action-1', setId: 'missing', name: 'Bad', createdAt: 1, updatedAt: 2,
        recording: { ...current, name: 'Bad' } }]
    }));
    expect(new SemanticActionLibrary(state.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/relationships/i)
    });
  });

  it('rejects obsolete versioned formats instead of carrying alpha migrations', () => {
    const state = memory(JSON.stringify({ format: 'lighttable-actions', version: 5,
      selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID, selectedId: null, sets: [], actions: [] }));
    expect(new SemanticActionLibrary(state.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/unsupported/i)
    });
  });

  it.each([
    ['untrimmed rationale', { rationale: ' private whitespace ' }],
    ['oversized rationale', { rationale: 'x'.repeat(281) }],
    ['unknown private field', { privateModelReasoning: 'must-not-survive' }]
  ])('rejects a malformed step with %s', (_label, injected) => {
    const current = recording();
    const state = memory(JSON.stringify({
      format: 'lighttable-actions', selectedSetId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
      selectedId: 'action-1',
      sets: [{ id: LIGHTTABLE_DEFAULT_ACTION_SET_ID, name: 'Default Set', createdAt: 0, updatedAt: 0 }],
      actions: [{ id: 'action-1', setId: LIGHTTABLE_DEFAULT_ACTION_SET_ID,
        name: current.name, createdAt: 1, updatedAt: 2,
        recording: { ...current, steps: [{ ...current.steps[0], ...injected }] } }]
    }));
    expect(new SemanticActionLibrary(state.storage).snapshot()).toMatchObject({
      actions: [], error: expect.stringMatching(/steps are malformed/i)
    });
  });

  it('refuses diagnostic or partially replayable recordings', async () => {
    const library = new SemanticActionLibrary();
    expect(await library.save({ ...recording(), steps: [{ ...recording().steps[0]!, replayable: false }] },
      'Unsafe')).toBeNull();
  });

  it('does not publish a late asynchronous restore after disposal', async () => {
    let resolveRead: ((value: string | null) => void) | undefined;
    const storage: SemanticActionLibraryStorage = {
      read: () => new Promise((resolve) => { resolveRead = resolve; }), write: () => undefined
    };
    const library = new SemanticActionLibrary(storage);
    const listener = vi.fn();
    library.subscribe(listener);
    library.dispose();
    resolveRead?.(null);
    await library.ready();
    expect(listener).not.toHaveBeenCalled();
  });
});
