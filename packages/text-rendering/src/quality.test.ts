import { describe, expect, it } from 'vitest';
import { compareR8Images, decideTextRendererBakeoff } from './quality';

describe('text renderer bakeoff quality', () => {
  it('computes normalized deterministic pixel errors', () => {
    expect(compareR8Images(new Uint8Array([0, 255]), new Uint8Array([0, 0])))
      .toEqual({ meanAbsoluteError: 0.5, maximumAbsoluteError: 1 });
  });

  it('keeps coverage as default while hb-gpu has only compile evidence', () => {
    const decision = decideTextRendererBakeoff([
      {
        candidate: 'coverage-atlas', scenarioId: 'small', coldPreparationMs: 1,
        warmFrameMs: 0.1, uploadBytes: 16, estimatedVramBytes: 16, drawBatches: 1,
        meanAbsoluteError: 0.01, maximumAbsoluteError: 0.1, shaderValidated: true
      },
      {
        candidate: 'hb-gpu', scenarioId: 'shader-only', coldPreparationMs: 1,
        warmFrameMs: 0.1, uploadBytes: 32, estimatedVramBytes: 32, drawBatches: 1,
        meanAbsoluteError: Number.NaN, maximumAbsoluteError: Number.NaN, shaderValidated: true
      }
    ]);
    expect(decision).toMatchObject({
      coverageAtlas: 'GO', hbGpu: 'CONDITIONAL GO', productionDefault: 'coverage-atlas'
    });
  });
});
