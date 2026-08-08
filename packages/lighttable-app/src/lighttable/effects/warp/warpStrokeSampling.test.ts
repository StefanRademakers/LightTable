import { describe, expect, it } from 'vitest';
import { createWarpGpuStamps, packWarpGpuStamps } from './warpStrokeSampling';
import type { WarpStroke } from './warpTypes';

const stroke = (delta: readonly [number, number]): WarpStroke => ({
  id: 'stroke',
  mode: 'push',
  settings: {
    diameterPx: 20,
    strength: 0.5,
    hardness: 0.75,
    flow: 0.8,
    spacing: 0.25,
    smooth: 0,
    pressureSize: false,
    pressureStrength: false
  },
  samples: [{
    positionPx: [20, 10],
    deltaPx: delta,
    pressure: 1,
    tilt: [0, 0],
    timeMs: 0
  }],
  startedAtMs: 0,
  durationMs: 10
});

describe('Warp stroke sampling', () => {
  it('uses document-space spacing instead of pointer event frequency', () => {
    const stamps = createWarpGpuStamps([stroke([12, 0])]);
    expect(stamps).toHaveLength(3);
    expect(stamps.map(({ centerPx }) => centerPx[0])).toEqual([12, 16, 20]);
    expect(stamps.every(({ deltaPx }) => deltaPx[0] === 4)).toBe(true);
  });

  it('packs one aligned pair of vec4 values per stamp', () => {
    const packed = packWarpGpuStamps(createWarpGpuStamps([stroke([4, 0])]));
    expect(packed).toHaveLength(8);
    expect([...packed.slice(0, 5)]).toEqual([20, 10, 4, 0, 10]);
    expect(packed[5]).toBeCloseTo(0.4);
    expect(packed[6]).toBeCloseTo(0.75);
    expect(packed[7]).toBe(0);
  });

  it.each([
    ['twirl-cw', 1],
    ['twirl-ccw', 2],
    ['pinch', 3],
    ['bloat', 4]
  ] as const)('packs executable %s stamps with mode %i', (mode, packedMode) => {
    const stamps = createWarpGpuStamps([{ ...stroke([1, 0]), mode }]);
    expect(stamps[0]?.mode).toBe(mode);
    expect(packWarpGpuStamps(stamps)[7]).toBe(packedMode);
  });

  it('fails loudly for field operators without an executor', () => {
    expect(() => createWarpGpuStamps([{ ...stroke([1, 0]), mode: 'smooth' }]))
      .toThrow('no GPU executor');
  });
});
