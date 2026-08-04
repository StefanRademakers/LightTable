import { describe, expect, it } from 'vitest';
import { layerThumbnailDimensions } from './layerThumbnailTypes';

describe('layerThumbnailDimensions', () => {
  it('fits landscape, portrait and square documents into one bounded slot', () => {
    expect(layerThumbnailDimensions(1000, 600)).toEqual({ width: 40, height: 24 });
    expect(layerThumbnailDimensions(600, 1000)).toEqual({ width: 24, height: 40 });
    expect(layerThumbnailDimensions(800, 800)).toEqual({ width: 40, height: 40 });
  });

  it('keeps invalid dimensions finite and visible', () => {
    expect(layerThumbnailDimensions(0, Number.NaN)).toEqual({ width: 40, height: 40 });
  });
});
