import { describe, expect, it } from 'vitest';
import {
  bindRecordedParameters,
  resolveActionParameters,
  validateActionVariables
} from './actionResultBindings';
import type { RecordedActionStep } from './semanticActionRecorder';

const createStep: RecordedActionStep = {
  sequence: 1, requestId: 'create', command: 'layer.createRaster', documentId: 'document-1',
  origin: 'ui',
  contract: { status: 'complete', schemaVersion: 1 },
  parameters: {}, outcome: 'completed', result: { created: true, layerId: 'generated-layer-1' },
  startedAt: 1, durationMs: 1, replayable: true, note: null, rationale: null
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

  it('resolves typed Action variables independently of result bindings', () => {
    expect(resolveActionParameters({
      name: { $lighttableVariable: { name: 'layerName' } },
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } }
    }, new Map([[1, { layerId: 'layer-2' }]]), new Map([['layerName', 'Headline']]))).toEqual({
      value: { name: 'Headline', layerId: 'layer-2' }
    });
  });

  it('rejects malformed, duplicate and mistyped variable definitions', () => {
    expect(validateActionVariables([
      { name: 'size', type: 'number', defaultValue: 'large' }
    ])).toContain('does not match');
    expect(validateActionVariables([
      { name: 'name', type: 'string', defaultValue: 'A' },
      { name: 'name', type: 'string', defaultValue: 'B' }
    ])).toContain('duplicated');
    expect(validateActionVariables([
      { name: 'bad name', type: 'string', defaultValue: 'A' }
    ])).toContain('invalid');
  });
});
