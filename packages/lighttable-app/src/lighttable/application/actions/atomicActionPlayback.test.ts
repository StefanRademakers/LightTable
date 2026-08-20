import { describe, expect, it } from 'vitest';
import { compileAtomicAction } from './atomicActionPlayback';
import type { ActionRecordingSnapshot, RecordedActionStep } from './semanticActionRecorder';

const step = (sequence: number, command: 'text.create' | 'layer.rename', parameters: unknown,
  result: unknown): RecordedActionStep => ({
  sequence, requestId: `request-${sequence}`, origin: 'ui', command,
  contract: { status: 'complete', schemaVersion: 1 }, documentId: 'document-1',
  parameters, outcome: 'completed', result, startedAt: sequence, durationMs: 1,
  replayable: true, note: null, rationale: null
});
const recording = (): ActionRecordingSnapshot => ({
  status: 'stopped', id: 'action-1', name: 'Create editable title', startedAt: 1, stoppedAt: 2,
  byteLength: 10, limitReached: false,
  variables: [{ name: 'title', type: 'string', defaultValue: 'Default title' }],
  steps: [
    step(1, 'text.create', { mode: 'point', text: { $lighttableVariable: { name: 'title' } },
      origin: { x: 40, y: 50 } }, { layerId: 'recorded-title' }),
    step(2, 'layer.rename', {
      layerId: { $lighttableResult: { step: 1, path: 'layerId' } }, name: 'Hero title'
    }, { layerId: 'recorded-title', name: 'Hero title' })
  ]
});

describe('atomic Action playback compiler', () => {
  it('compiles variables and prior top-level results into one bounded batch', () => {
    const compiled = compileAtomicAction(recording(), 'fresh-document', { title: 'Agent title' });

    expect(compiled).toEqual({ ok: true, plan: {
      documentId: 'fresh-document', steps: recording().steps,
      batch: { name: 'Create editable title', timeoutMs: 5_000, operations: [{
        operationId: 'step-1', command: 'text.create',
        parameters: { mode: 'point', text: 'Agent title', origin: { x: 40, y: 50 } }
      }, {
        operationId: 'step-2', command: 'layer.rename',
        parameters: { layerId: { resultOf: 'step-1', field: 'layerId' }, name: 'Hero title' }
      }] }
    } });
  });

  it.each([
    ['a non-batch command', { steps: [{ ...recording().steps[0]!, command: 'layer.createRaster' }] }, /cannot publish/i],
    ['an asynchronous step', { steps: [{ ...recording().steps[0]!, outcome: 'accepted' }] }, /asynchronous/i],
    ['a diagnostic step', { steps: [{ ...recording().steps[0]!, replayable: false }] }, /diagnostic/i],
    ['multiple documents', { steps: [recording().steps[0]!,
      { ...recording().steps[1]!, documentId: 'document-2' }] }, /one recorded document/i],
    ['a nested result path', { steps: [recording().steps[0]!, { ...recording().steps[1]!, parameters: {
      layerId: { $lighttableResult: { step: 1, path: 'artifact.id' } }, name: 'Hero title'
    } }] }, /nested/i]
  ] as const)('rejects %s before execution', (_label, change, expected) => {
    expect(compileAtomicAction({ ...recording(), ...change })).toEqual({
      ok: false, error: expect.stringMatching(expected)
    });
  });

  it('rejects invalid overrides and oversized workflows before execution', () => {
    expect(compileAtomicAction(recording(), undefined, { title: 42 })).toEqual({
      ok: false, error: expect.stringMatching(/requires a string/i)
    });
    const repeated = Array.from({ length: 65 }, (_, index) => ({
      ...recording().steps[1]!, sequence: index + 1, requestId: `request-${index + 1}`,
      parameters: { layerId: 'existing-layer', name: `Layer ${index + 1}` }
    }));
    expect(compileAtomicAction({ ...recording(), steps: repeated })).toEqual({
      ok: false, error: expect.stringMatching(/at most 64/i)
    });
  });
});
