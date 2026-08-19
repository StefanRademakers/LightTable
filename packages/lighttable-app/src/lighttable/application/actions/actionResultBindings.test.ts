import { describe, expect, it } from 'vitest';
import { bindRecordedParameters, resolveActionParameters } from './actionResultBindings';
import type { RecordedActionStep } from './semanticActionRecorder';

const createStep: RecordedActionStep = {
  sequence: 1, requestId: 'create', command: 'layer.createRaster', documentId: 'document-1',
  parameters: {}, outcome: 'completed', result: { layerId: 'generated-layer-1' },
  startedAt: 1, durationMs: 1, replayable: true, note: null
};

describe('action result bindings', () => {
  it('replaces stable result identities in later recorded parameters', () => {
    expect(bindRecordedParameters({
      layerId: 'generated-layer-1', name: 'generated-layer-1', untouched: 'generated-layer-2'
    }, [createStep])).toEqual({
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } },
      name: 'generated-layer-1', untouched: 'generated-layer-2'
    });
  });

  it('resolves bindings from results produced by this playback', () => {
    expect(resolveActionParameters({
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } }, name: 'Title'
    }, new Map([[1, { layerId: 'new-layer-for-this-run' }]]))).toEqual({
      value: { layerId: 'new-layer-for-this-run', name: 'Title' }
    });
  });

  it('fails closed when a referenced result is unavailable', () => {
    expect(resolveActionParameters({
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } }
    }, new Map())).toEqual({ error: 'Step 1 result has no layerId.' });
  });
});
