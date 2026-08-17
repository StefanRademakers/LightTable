import { describe, expect, it } from 'vitest';
import {
  clonePointColor,
  createDefaultPointColor,
  createPointColorSample,
  MAX_POINT_COLOR_SAMPLES,
  pointColorIsActive
} from './pointColor';

describe('Point Color settings', () => {
  it('is neutral until a sampled color is adjusted', () => {
    const sample = createPointColorSample('skin', 0.7, 0.12, 0.8);
    expect(pointColorIsActive({ samples: [sample] })).toBe(false);
    expect(pointColorIsActive({ samples: [{ ...sample, hueShift: 12 }] })).toBe(true);
  });

  it('clones at most the eight samples supported by the editor and GPU payload', () => {
    const source = {
      samples: Array.from({ length: 10 }, (_, index) =>
        createPointColorSample(`${index}`, 0.5, 0.1, index))
    };
    const clone = clonePointColor(source);
    expect(clone.samples).toHaveLength(MAX_POINT_COLOR_SAMPLES);
    expect(clone.samples).not.toBe(source.samples);
    expect(createDefaultPointColor()).toEqual({ samples: [] });
  });
});
