import { describe, expect, it } from 'vitest';
import { createDefaultLayerStyle } from './layerStyleDefaults';
import { gradientPaintFromLayerStyle } from './layerStyleGradientPaint';

describe('Layer Style gradient paint bridge', () => {
  it('maps the existing editor asset and geometry to the shared paint contract', () => {
    const effect = createDefaultLayerStyle('gradient-overlay');
    if (effect.kind !== 'gradient-overlay') throw new Error('Expected gradient overlay.');
    effect.alignWithLayer = false;
    effect.angle = 90;
    effect.scale = 2;
    effect.offsetX = 0.25;
    effect.offsetY = -0.5;
    const paint = gradientPaintFromLayerStyle(effect);
    expect(paint).toMatchObject({
      asset: effect.gradient,
      shape: effect.style,
      coordinateSpace: 'document',
      transform: { b: 2, c: -2, tx: 0.25, ty: -0.5 }
    });
    expect(paint?.transform.a).toBeCloseTo(0);
    expect(paint?.transform.d).toBeCloseTo(0);
  });

  it('does not invent gradient state for a color stroke', () => {
    const effect = createDefaultLayerStyle('stroke');
    if (effect.kind !== 'stroke') throw new Error('Expected stroke.');
    expect(gradientPaintFromLayerStyle(effect)).toBeNull();
  });
});
