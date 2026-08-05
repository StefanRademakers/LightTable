import type {
  Color,
  EffectContour,
  EffectSolidGradient,
  LayerEffectsInfo,
  UnitsValue
} from 'ag-psd';
import type { BlendMode } from '../document/blendModes';
import type {
  LayerStyleColor,
  LayerStyleContour,
  LayerStyleGradient,
  LayerStyleInstance,
  LayerStyleStack
} from '../styles/layerStyleTypes';

const px = (value: number): UnitsValue => ({ units: 'Pixels', value });
const percent = (value: number): number => Math.max(0, Math.min(1, value));
const color = (value: LayerStyleColor): Color => ({
  r: Math.round(percent(value.r) * 255),
  g: Math.round(percent(value.g) * 255),
  b: Math.round(percent(value.b) * 255),
  a: Math.round(percent(value.a) * 255)
});
const blendMode = (value: BlendMode) => value.replaceAll('-', ' ') as NonNullable<LayerEffectsInfo['dropShadow']>[number]['blendMode'];
const contour = (value: LayerStyleContour): EffectContour => ({
  name: 'Custom',
  // ag-psd exposes Photoshop's descriptor-native contour coordinates here,
  // unlike gradients/opacity which use normalized values. Photoshop expects
  // the complete 0..255 domain; writing 0..1 makes an otherwise enabled
  // shadow or glow effectively disappear after export.
  curve: value.points.map((point) => ({
    x: Math.round(percent(point.position) * 255),
    y: Math.round(percent(point.value) * 255)
  }))
});
const gradient = (value: LayerStyleGradient): EffectSolidGradient => ({
  name: value.name,
  type: 'solid',
  smoothness: value.smoothness,
  colorStops: value.colorStops.map((stop) => ({
    color: color(stop.color), location: stop.position, midpoint: stop.midpoint
  })),
  opacityStops: value.opacityStops.map((stop) => ({
    opacity: stop.opacity, location: stop.position, midpoint: stop.midpoint
  }))
});

const common = (effect: LayerStyleInstance) => ({
  present: true,
  showInDialog: true,
  enabled: effect.enabled,
  blendMode: blendMode(effect.blendMode),
  opacity: effect.opacity
});

/** Projects the canonical style stack back to Photoshop's editable lfxx data. */
export const exportLayerStyleStackToPsd = (
  stack: LayerStyleStack
): LayerEffectsInfo | undefined => {
  if (stack.effects.length === 0) return undefined;
  const result: LayerEffectsInfo = { disabled: !stack.enabled, scale: stack.scale };
  for (const effect of stack.effects) {
    const base = common(effect);
    switch (effect.kind) {
      case 'drop-shadow':
      case 'inner-shadow': {
        const target = effect.kind === 'drop-shadow'
          ? (result.dropShadow ??= []) : (result.innerShadow ??= []);
        target.push({
          ...base, size: px(effect.size), angle: effect.angle,
          distance: px(effect.distance), color: color(effect.color),
          useGlobalLight: effect.useGlobalLight, antialiased: effect.antiAlias,
          contour: contour(effect.contour), choke: px((effect.kind === 'drop-shadow'
            ? effect.spread : effect.choke) * 100),
          ...(effect.kind === 'drop-shadow' ? { layerConceals: effect.layerKnocksOut } : {})
        });
        break;
      }
      case 'outer-glow':
      case 'inner-glow': {
        const projected = {
          ...base, size: px(effect.size), color: color(effect.color),
          antialiased: effect.antiAlias, noise: effect.noise, range: effect.range,
          choke: px(effect.choke * 100), jitter: effect.jitter,
          contour: contour(effect.contour), technique: effect.technique,
          ...(effect.kind === 'inner-glow' ? { source: effect.source } : {})
        };
        if (effect.kind === 'outer-glow') result.outerGlow = projected;
        else result.innerGlow = projected;
        break;
      }
      case 'color-overlay':
        (result.solidFill ??= []).push({ ...base, color: color(effect.color) });
        break;
      case 'gradient-overlay':
        (result.gradientOverlay ??= []).push({
          ...base, gradient: gradient(effect.gradient), dither: effect.dither,
          reverse: effect.reverse, type: effect.style, align: effect.alignWithLayer,
          angle: effect.angle, scale: effect.scale, offset: {
            x: effect.offsetX, y: effect.offsetY
          }, interpolationMethod: effect.method
        });
        break;
      case 'stroke': {
        const fill = effect.fill;
        (result.stroke ??= []).push({
          ...base, size: px(effect.size), position: effect.position,
          overprint: effect.overprint,
          ...(fill.type === 'color'
            ? { fillType: 'color' as const, color: color(fill.color) }
            : fill.type === 'gradient'
              ? { fillType: 'gradient' as const, gradient: {
                ...gradient(fill.gradient), dither: fill.dither,
                reverse: fill.reverse, style: fill.style,
                align: fill.alignWithLayer, angle: fill.angle,
                scale: fill.scale, offset: { x: fill.offsetX, y: fill.offsetY },
                interpolationMethod: fill.method
              } }
              : { fillType: 'pattern' as const, pattern: fill.pattern
                ? { id: fill.pattern.id, name: fill.pattern.name } : undefined })
        });
        break;
      }
      case 'satin':
        result.satin = {
          ...base, size: px(effect.size), distance: px(effect.distance),
          angle: effect.angle, color: color(effect.color),
          antialiased: effect.antiAlias, invert: effect.invert,
          contour: contour(effect.contour)
        };
        break;
      case 'bevel-emboss':
        result.bevel = {
          ...base, size: px(effect.size), soften: px(effect.soften),
          angle: effect.angle, altitude: effect.altitude, strength: effect.depth,
          useGlobalLight: effect.useGlobalLight,
          highlightBlendMode: blendMode(effect.highlightMode),
          shadowBlendMode: blendMode(effect.shadowMode),
          highlightColor: color(effect.highlightColor), shadowColor: color(effect.shadowColor),
          highlightOpacity: effect.highlightOpacity, shadowOpacity: effect.shadowOpacity,
          style: effect.style.replaceAll('-', ' ') as NonNullable<LayerEffectsInfo['bevel']>['style'],
          technique: effect.technique.replaceAll('-', ' ') as NonNullable<LayerEffectsInfo['bevel']>['technique'],
          direction: effect.direction, antialiasGloss: effect.antiAlias,
          contour: contour(effect.contour), useTexture: effect.texture.enabled
        };
        break;
      case 'pattern-overlay':
        if (effect.pattern) result.patternOverlay = {
          ...base, pattern: { id: effect.pattern.id, name: effect.pattern.name },
          scale: effect.scale, phase: { x: effect.offsetX, y: effect.offsetY },
          align: effect.linkWithLayer
        };
        break;
    }
  }
  return result;
};
