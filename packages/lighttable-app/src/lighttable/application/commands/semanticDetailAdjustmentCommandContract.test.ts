import { describe, expect, it } from 'vitest';
import { parseSemanticDetailAdjustmentCommand } from './semanticDetailAdjustmentCommandContract';

describe('semantic Detail adjustment command', () => {
  it('accepts bounded document and layer patches', () => {
    expect(parseSemanticDetailAdjustmentCommand({
      target: { kind: 'document' },
      values: { sharpeningAmount: 45, sharpeningRadius: 1.1 }
    })).toEqual({
      target: { kind: 'document' },
      values: { sharpeningAmount: 45, sharpeningRadius: 1.1 }
    });
    expect(parseSemanticDetailAdjustmentCommand({
      target: { kind: 'layer', layerId: 'portrait' },
      values: { luminanceNoiseReduction: 30, colorNoiseReduction: 20 }
    })).not.toHaveProperty('message');
  });

  it('rejects empty, private and out-of-range values', () => {
    for (const parameters of [
      { target: { kind: 'document' }, values: {} },
      { target: { kind: 'document' }, values: { sharpeningRadius: 0.49 } },
      { target: { kind: 'document' }, values: { sharpeningAmount: 151 } },
      { target: { kind: 'document' }, values: { privateKernel: [1, 2, 3] } },
      { target: { kind: 'layer', layerId: '' }, values: { colorDetail: 50 } }
    ]) expect(parseSemanticDetailAdjustmentCommand(parameters)).toHaveProperty('message');
  });
});
