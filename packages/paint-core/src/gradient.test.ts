import { describe, expect, it } from 'vitest';
import { cloneGradientAsset, gradientAssetIsValid, identityPaintTransform } from './gradient';

const asset = {
  id: 'gradient-1', name: 'Black, White', type: 'solid' as const, smoothness: 1,
  colorStops: [
    { id: 'black', position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
    { id: 'white', position: 1, midpoint: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } }
  ],
  opacityStops: [
    { id: 'opaque-0', position: 0, midpoint: 0.5, opacity: 1 },
    { id: 'opaque-1', position: 1, midpoint: 0.5, opacity: 1 }
  ],
  roughness: 0, seed: 0
};

describe('gradient paint contract', () => {
  it('separates reusable color data from instance geometry', () => {
    expect(gradientAssetIsValid(asset)).toBe(true);
    expect(identityPaintTransform()).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
  });

  it('clones nested stops without sharing mutable imported data', () => {
    const clone = cloneGradientAsset(asset);
    expect(clone).toEqual(asset);
    expect(clone.colorStops).not.toBe(asset.colorStops);
    expect(clone.colorStops[0]?.color).not.toBe(asset.colorStops[0]?.color);
  });

  it('rejects invalid normalized channels and positions', () => {
    expect(gradientAssetIsValid({ ...asset, smoothness: 2 })).toBe(false);
    expect(gradientAssetIsValid({ ...asset, opacityStops: [] })).toBe(false);
  });
});
