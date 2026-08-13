import { describe, expect, it } from 'vitest';
import { refineBackgroundRemovalMask } from './backgroundRemovalMask';
import { BEN2_BASE_PROFILE, BIREFNET_LITE_BENCHMARK_PROFILE } from './backgroundRemovalModels';

describe('background removal mask refinement', () => {
  it('preserves confident matte values and multiplies source alpha', () => {
    const predicted = new Uint8Array([0, 255, 255, 128]);
    const source = new Uint8Array([
      0, 0, 0, 255,
      255, 255, 255, 128,
      255, 255, 255, 0,
      128, 128, 128, 255
    ]);

    const result = refineBackgroundRemovalMask(predicted, source, 2, 2);

    expect(result[0]).toBe(0);
    expect(result[1]).toBe(128);
    expect(result[2]).toBe(0);
    expect(result[3]).toBeGreaterThan(120);
    expect(result[3]).toBeLessThan(200);
  });

  it('rejects dimension mismatches instead of silently cropping', () => {
    expect(() => refineBackgroundRemovalMask(
      new Uint8Array(3), new Uint8Array(16), 2, 2
    )).toThrow('dimensions');
  });
});

describe('background removal model profiles', () => {
  it('pins the production BEN2 artifact while keeping BiRefNet benchmark-only', () => {
    expect(BEN2_BASE_PROFILE).toMatchObject({
      production: true,
      revision: 'c552aa82688edce09f0ac9d2e31ad53d9d629010',
      artifactSha256: 'dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1',
      license: 'MIT'
    });
    expect(BIREFNET_LITE_BENCHMARK_PROFILE.production).toBe(false);
  });
});
