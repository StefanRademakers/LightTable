import { describe, expect, it } from 'vitest';
import { observedCommandParametersAreValid } from './observedCommandValidation';

describe('observed command validation', () => {
  it('accepts a replayable text commit and rejects malformed or unowned observers', () => {
    expect(observedCommandParametersAreValid('text.replaceRange', {
      layerId: 'text-layer', start: 0, end: 4, text: 'Editable'
    })).toBe(true);
    expect(observedCommandParametersAreValid('text.replaceRange', {
      layerId: 'text-layer', start: 4, end: 0, text: 'invalid'
    })).toBe(false);
    expect(observedCommandParametersAreValid('layer.rename', {
      layerId: 'layer', name: 'Not an observed owner'
    })).toBe(false);
  });

  it('accepts only stable Select Subject intent', () => {
    const intent = { kind: 'subject', sourceLayerId: 'photo', mode: 'replace',
      sampleAllLayers: false };
    expect(observedCommandParametersAreValid('selection.selectSubject', intent)).toBe(true);
    expect(observedCommandParametersAreValid('selection.selectSubject', {
      ...intent, modelId: 'replaceable-private-model'
    })).toBe(false);
  });
});
