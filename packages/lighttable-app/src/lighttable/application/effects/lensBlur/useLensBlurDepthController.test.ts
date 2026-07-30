import { describe, expect, it } from 'vitest';
import { depthReadyProgress } from './useLensBlurDepthController';

describe('depthReadyProgress', () => {
  it('publishes deterministic dimensions for diagnostics and UI', () => {
    expect(depthReadyProgress({ width: 384, height: 216 })).toEqual({
      status: 'ready',
      message: 'Depth ready (384 x 216)'
    });
  });
});

