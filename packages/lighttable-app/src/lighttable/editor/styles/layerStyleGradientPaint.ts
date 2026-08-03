import type { GradientPaintInstance, PaintAffineTransform } from '@lighttable/paint-core';
import type { GradientOverlayStyle, StrokeStyle } from './layerStyleTypes';

const geometryTransform = (
  angleDegrees: number,
  scale: number,
  offsetX: number,
  offsetY: number
): PaintAffineTransform => {
  const radians = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(radians) * scale;
  const sine = Math.sin(radians) * scale;
  return { a: cosine, b: sine, c: -sine, d: cosine, tx: offsetX, ty: offsetY };
};

export const gradientPaintFromLayerStyle = (
  effect: GradientOverlayStyle | StrokeStyle
): GradientPaintInstance | null => {
  if (effect.kind === 'gradient-overlay') {
    return {
      kind: 'gradient',
      asset: effect.gradient,
      shape: effect.style,
      coordinateSpace: effect.alignWithLayer ? 'layer' : 'document',
      transform: geometryTransform(effect.angle, effect.scale, effect.offsetX, effect.offsetY),
      reverse: effect.reverse,
      dither: effect.dither,
      interpolation: effect.method
    };
  }
  if (effect.fill.type !== 'gradient') return null;
  return {
    kind: 'gradient',
    asset: effect.fill.gradient,
    shape: effect.fill.style,
    coordinateSpace: effect.fill.alignWithLayer ? 'layer' : 'document',
    transform: geometryTransform(
      effect.fill.angle,
      effect.fill.scale,
      effect.fill.offsetX,
      effect.fill.offsetY
    ),
    reverse: effect.fill.reverse,
    dither: effect.fill.dither,
    interpolation: effect.fill.method
  };
};
