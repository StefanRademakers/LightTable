import { describe, expect, it } from 'vitest';
import {
  buildPhotoshopColorVibranceCompatibility,
  PHOTOSHOP_COLOR_VIBRANCE_COLOR_KNOTS,
  PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE,
  PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_KNOTS,
  PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE
} from './photoshopColorVibranceCompatibility';

describe('Photoshop Color and Vibrance compatibility', () => {
  it('interpolates the coupled Temperature/Tint surface into one RGBA volume', () => {
    const voxels = PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_SIZE ** 3;
    const tableBytes = voxels * 3;
    const bytes = new Uint8Array(
      PHOTOSHOP_COLOR_VIBRANCE_COMPATIBILITY_KNOTS.length ** 2 * tableBytes
        + PHOTOSHOP_COLOR_VIBRANCE_COLOR_KNOTS.length ** 2
          * PHOTOSHOP_COLOR_VIBRANCE_COLOR_SIZE ** 3 * 3
    );
    for (let temperature = 0; temperature < 21; temperature += 1) {
      for (let tint = 0; tint < 21; tint += 1) {
        bytes.fill(temperature * 10 + tint, (temperature * 21 + tint) * tableBytes,
          (temperature * 21 + tint + 1) * tableBytes);
      }
    }
    const result = buildPhotoshopColorVibranceCompatibility(bytes, -95, -85);
    expect([...result.slice(0, 4)]).toEqual([7, 7, 7, 255]);
    expect(result).toHaveLength(voxels * 4);
  });

  it('rejects truncated assets before interpolation', () => {
    expect(() => buildPhotoshopColorVibranceCompatibility(new Uint8Array(3), 0, 0))
      .toThrow('Invalid Color and Vibrance compatibility data.');
  });
});
