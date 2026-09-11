import { describe, expect, it } from 'vitest';
import { depthReadyProgress, retiredDepthProgress } from './useLensBlurDepthController';

describe('depthReadyProgress', () => {
  it('pairs canceled/unavailable results with idle, preserving only a same-source genuine failure', () => {
    expect(retiredDepthProgress({ status: 'ready' }, true)).toEqual({ status: 'idle' });
    expect(retiredDepthProgress({ status: 'loading-model' }, true)).toEqual({ status: 'idle' });
    const failed = { status: 'error' as const, message: 'Analysis failed' };
    expect(retiredDepthProgress(failed, true)).toBe(failed);
    expect(retiredDepthProgress(failed, false)).toEqual({ status: 'idle' });
  });
  it('publishes deterministic dimensions for diagnostics and UI', () => {
    expect(depthReadyProgress({ width: 384, height: 216 })).toEqual({
      status: 'ready',
      message: 'Depth ready (384 x 216)'
    });
  });
});
