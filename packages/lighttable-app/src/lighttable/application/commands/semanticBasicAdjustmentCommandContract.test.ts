import { describe, expect, it } from 'vitest';
import { parseSemanticBasicAdjustmentCommand } from './semanticBasicAdjustmentCommandContract';

describe('semantic basic adjustment command contract', () => {
  it('parses bounded document and stable layer patches', () => {
    expect(parseSemanticBasicAdjustmentCommand({
      target: { kind: 'document' },
      values: { exposureEV: 1.25, contrast: -20 }
    })).toEqual({
      target: { kind: 'document' },
      values: { exposureEV: 1.25, contrast: -20 }
    });
    expect(parseSemanticBasicAdjustmentCommand({
      target: { kind: 'layer', layerId: 'photo' },
      values: { temperature: -100, saturation: 100 }
    })).toEqual({
      target: { kind: 'layer', layerId: 'photo' },
      values: { temperature: -100, saturation: 100 }
    });
  });

  it('rejects empty, unknown, non-finite and out-of-range values', () => {
    for (const values of [
      {},
      { madeUp: 1 },
      { exposureEV: Number.NaN },
      { exposureEV: 5.01 },
      { temperature: -101 }
    ]) {
      expect(parseSemanticBasicAdjustmentCommand({
        target: { kind: 'document' }, values
      })).toHaveProperty('message');
    }
  });
});

