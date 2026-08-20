import { describe, expect, it } from 'vitest';
import { planDocumentRegionPreview } from './documentRegionPreview';

describe('planDocumentRegionPreview', () => {
  it('maps document pixels to UVs and downsizes without changing aspect ratio', () => {
    expect(planDocumentRegionPreview(4000, 3000,
      { x: 1000, y: 750, width: 2000, height: 1000 }, 500)).toEqual({
      region: { x: 1000, y: 750, width: 2000, height: 1000 },
      outputWidth: 500, outputHeight: 250,
      uvOrigin: [0.25, 0.25], uvScale: [0.5, 1 / 3]
    });
  });

  it('rejects empty, non-finite and out-of-document regions', () => {
    for (const region of [
      { x: -1, y: 0, width: 10, height: 10 },
      { x: 95, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
      { x: 0, y: Number.NaN, width: 10, height: 10 }
    ]) expect(planDocumentRegionPreview(100, 100, region, 64)).toBeNull();
  });
});
