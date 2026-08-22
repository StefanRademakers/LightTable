import { describe, expect, it } from 'vitest';
import {
  cloneGradientAsset,
  cloneGradientPaint,
  createDefaultGradientPaint,
  gradientAssetIsValid,
  gradientPaintIsValid,
  identityPaintTransform,
  sampleGradientAsset
} from './gradient';

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

  it('validates and deeply clones a positioned paint instance', () => {
    const paint = {
      kind: 'gradient' as const, asset, shape: 'linear' as const,
      coordinateSpace: 'object-bounds' as const, transform: identityPaintTransform(),
      reverse: false, dither: false, interpolation: 'perceptual' as const
    };
    expect(gradientPaintIsValid(paint)).toBe(true);
    const clone = cloneGradientPaint(paint);
    expect(clone).toEqual(paint);
    expect(clone.asset).not.toBe(paint.asset);
    expect(clone.transform).not.toBe(paint.transform);
  });

  it('validates and clones SVG-compatible radial focal geometry', () => {
    const paint = {
      kind: 'gradient' as const, asset, shape: 'radial' as const,
      coordinateSpace: 'object-bounds' as const, transform: identityPaintTransform(),
      radialFocus: { x: -0.25, y: 0.2 }, radialStartRadius: 0.1,
      reverse: false, dither: false, interpolation: 'classic' as const
    };
    expect(gradientPaintIsValid(paint)).toBe(true);
    const clone = cloneGradientPaint(paint);
    expect(clone.radialFocus).toEqual(paint.radialFocus);
    expect(clone.radialFocus).not.toBe(paint.radialFocus);
    expect(gradientPaintIsValid({ ...paint, radialFocus: { x: 0.95, y: 0 }, radialStartRadius: 0.1 }))
      .toBe(false);
    expect(gradientPaintIsValid({ ...paint, shape: 'linear' })).toBe(false);
  });

  it('samples independent color and opacity stops with midpoint semantics', () => {
    const sampled = sampleGradientAsset({
      ...asset,
      colorStops: asset.colorStops.map((stop) => ({ ...stop, midpoint: 0.25 })),
      opacityStops: [
        { id: 'transparent', position: 0, midpoint: 0.5, opacity: 0 },
        { id: 'opaque', position: 1, midpoint: 0.5, opacity: 1 }
      ]
    }, 0.25);
    expect(sampled).toMatchObject({ r: 0.5, g: 0.5, b: 0.5, a: 0.25 });
  });

  it('creates a complete editable default without shared stop state', () => {
    const first = createDefaultGradientPaint('first');
    const second = createDefaultGradientPaint('second');
    expect(first).toMatchObject({ kind: 'gradient', coordinateSpace: 'object-bounds', dither: true });
    expect(gradientPaintIsValid(first)).toBe(true);
    expect(first.asset.colorStops).not.toBe(second.asset.colorStops);
  });
});
