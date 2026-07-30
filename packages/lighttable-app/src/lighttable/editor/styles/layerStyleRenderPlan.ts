import type { RasterLayer, Rect } from '../document/documentTypes';
import type { AffineMatrix } from '../rendering/renderContract';
import type { LayerStyleInstance, LayerStyleStack } from './layerStyleTypes';

export type LayerStyleRenderQuality = 'interactive' | 'final';

const effectExpansion = (effect: LayerStyleInstance, scale: number) => {
  if (!effect.enabled || effect.opacity <= 0) return 0;
  switch (effect.kind) {
    case 'drop-shadow':
      return (effect.distance + effect.size) * scale;
    case 'outer-glow':
      return effect.size * scale;
    case 'stroke':
      return effect.position === 'inside' ? 0 : effect.size * scale;
    case 'bevel-emboss':
      return effect.style === 'inner-bevel' || effect.style === 'pillow-emboss'
        ? 0
        : (effect.size + effect.soften) * scale;
    default:
      return 0;
  }
};

/** Conservative document-space padding used for invalidation and culling. */
export const layerStyleExpansion = (stack: LayerStyleStack) =>
  stack.enabled
    ? stack.effects.reduce(
        (maximum, effect) => Math.max(maximum, effectExpansion(effect, stack.scale)),
        0
      )
    : 0;

const transformedBounds = (
  width: number,
  height: number,
  transform: AffineMatrix
): Rect => {
  const points = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height }
  ].map(({ x, y }) => ({
    x: transform.a * x + transform.c * y + transform.tx,
    y: transform.b * x + transform.d * y + transform.ty
  }));
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top
  };
};

export const layerStyleDocumentBounds = (
  layer: RasterLayer,
  canvas: { width: number; height: number },
  transform: AffineMatrix = layer.transform
): Rect => {
  const source = transformedBounds(layer.width, layer.height, transform);
  const expansion = layerStyleExpansion(layer.styleStack);
  const left = Math.max(0, source.x - expansion);
  const top = Math.max(0, source.y - expansion);
  const right = Math.min(canvas.width, source.x + source.width + expansion);
  const bottom = Math.min(canvas.height, source.y + source.height + expansion);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
};

export const layerStyleCacheKey = (
  layer: RasterLayer,
  transform: AffineMatrix,
  quality: LayerStyleRenderQuality
) => [
  layer.pixelRevision,
  layer.mask?.enabled ? layer.mask.pixelRevision : 'mask-off',
  layer.mask?.enabled ? layer.mask.id : 'no-mask-id',
  layer.mask?.enabled ? layer.mask.density : 'no-mask-density',
  layer.mask?.enabled ? layer.mask.feather : 'no-mask-feather',
  layer.geometryRevision,
  layer.width,
  layer.height,
  layer.fillOpacity,
  layer.styleStack.revision,
  quality,
  transform.a,
  transform.b,
  transform.c,
  transform.d,
  transform.tx,
  transform.ty
].join(':');
