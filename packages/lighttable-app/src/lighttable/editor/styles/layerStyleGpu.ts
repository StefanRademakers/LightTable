import { blendModeGpuValue } from '../document/blendModes';
import type {
  LayerStyleGradient,
  LayerStyleInstance,
  LayerStyleStack
} from './layerStyleTypes';

export const MAX_LAYER_STYLE_GRADIENT_STOPS = 8;
export const MAX_LAYER_STYLE_CONTOUR_POINTS = 8;
export const LAYER_STYLE_SETTINGS_FLOATS = 156;
export const LAYER_STYLE_SETTINGS_BYTES = LAYER_STYLE_SETTINGS_FLOATS * 4;

const srgbToLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const color = (value: { r: number; g: number; b: number; a: number }) => [
  srgbToLinear(value.r),
  srgbToLinear(value.g),
  srgbToLinear(value.b),
  value.a
] as const;

const empty = () => new Float32Array(LAYER_STYLE_SETTINGS_FLOATS);

export const layerStyleBlurRadius = (effect: LayerStyleInstance, scale: number) => {
  switch (effect.kind) {
    case 'drop-shadow':
    case 'inner-shadow':
    case 'outer-glow':
    case 'inner-glow':
    case 'stroke':
    case 'satin':
      return effect.size * scale;
    case 'bevel-emboss':
      return Math.max(effect.size, effect.soften) * scale;
    default:
      return 0;
  }
};

export interface LayerStyleGaussianBlurPlan {
  scale: number;
  workingWidth: number;
  workingHeight: number;
  workingRadius: number;
}

/**
 * 1+JFA followed by a final local correction. The leading unit pass prevents
 * adjacent anti-aliased seeds from being eliminated before long jumps; the
 * trailing unit pass repairs local Voronoi errors left by approximate JFA.
 */
export const bevelJumpFloodSteps = (maximumDistance: number) => {
  const distance = Math.max(1, Math.ceil(maximumDistance));
  let step = 1;
  while (step * 2 <= distance) step *= 2;
  const result = [1];
  for (; step >= 1; step = Math.floor(step / 2)) result.push(step);
  result.push(1);
  return result;
};

/**
 * Retained Chisel fields grow in power-of-two support buckets. Size gestures
 * inside the existing capacity only remap the cached distance profile; they
 * do not regenerate the distance transform.
 */
export const bevelDistanceCapacity = (requestedDistance: number) => {
  const requested = Math.max(1, Math.ceil(requestedDistance));
  let capacity = 1;
  while (capacity < requested) capacity *= 2;
  return capacity;
};

/**
 * BlurCore has contiguous support through 100 pixels. Wider Smooth bevels
 * use repeated ROI convolutions; Gaussian variances add, so every cycle stays
 * dense instead of exposing a sparse set of authored-radius samples.
 */
export const smoothBevelGaussianPlan = (radius: number) => {
  const requested = Math.max(0, radius);
  const cycles = Math.max(1, Math.ceil((requested / 100) ** 2));
  return { cycles, radiusPerCycle: requested / Math.sqrt(cycles) };
};

export const smoothBevelMultiscalePlan = (
  radius: number,
  width: number,
  height: number,
  targetRadius = 16
) => {
  const requested = Math.max(0, radius);
  let scale = 1;
  // Power-of-two box-prefiltered reduction keeps the coordinate mapping and
  // cache sizes deterministic. Preserve at least an 8x8 height field so tiny
  // layers never disappear merely because the authored radius is large.
  while (
    requested / scale > targetRadius
    && scale < 16
    && Math.ceil(width / (scale * 2)) >= 8
    && Math.ceil(height / (scale * 2)) >= 8
  ) scale *= 2;
  return {
    scale,
    workingWidth: Math.max(1, Math.ceil(width / scale)),
    workingHeight: Math.max(1, Math.ceil(height / scale)),
    workingRadius: requested / scale
  };
};

export const layerStyleGaussianBlurPlan = (
  effect: LayerStyleInstance,
  stack: LayerStyleStack,
  width: number,
  height: number,
  quality: 'interactive' | 'final'
): LayerStyleGaussianBlurPlan | null => {
  if (![
    'drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'satin', 'bevel-emboss'
  ].includes(effect.kind)) {
    return null;
  }
  if (effect.kind === 'bevel-emboss' && effect.technique !== 'smooth') return null;
  if ((effect.kind === 'outer-glow' || effect.kind === 'inner-glow') && effect.jitter > 0) {
    return null;
  }
  const radius = layerStyleBlurRadius(effect, stack.scale);
  if (radius <= 8) return null;
  const pixelsPerWorkingRadius = quality === 'interactive' ? 6 : 8;
  const scale = Math.max(2, Math.min(8, Math.ceil(radius / pixelsPerWorkingRadius)));
  return {
    scale,
    workingWidth: Math.max(1, Math.ceil(width / scale)),
    workingHeight: Math.max(1, Math.ceil(height / scale)),
    workingRadius: radius / scale
  };
};

const adaptiveBlurSamples = (
  effect: LayerStyleInstance,
  scale: number,
  quality: 'interactive' | 'final'
) => {
  const radius = layerStyleBlurRadius(effect, scale);
  if (radius <= 0.01) return 1;
  if (effect.kind === 'stroke') {
    // Morphological stroke coverage needs enough angular samples to keep wide
    // outlines round, but small strokes should remain cheap while dragging.
    const minimum = quality === 'interactive' ? 16 : 24;
    const maximum = quality === 'interactive' ? 32 : 128;
    return Math.min(maximum, Math.max(minimum, Math.ceil(radius / 4) * 8));
  }
  const interval = quality === 'interactive' ? 20 : 10;
  const minimum = quality === 'interactive' ? 8 : 16;
  const maximum = quality === 'interactive' ? 16 : 64;
  const requested = Math.ceil(radius / interval) * 8;
  return Math.min(maximum, Math.max(minimum, requested));
};

const writeGradient = (
  values: Float32Array,
  gradient: LayerStyleGradient
) => {
  const colorStops = [...gradient.colorStops]
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_LAYER_STYLE_GRADIENT_STOPS);
  const opacityStops = [...gradient.opacityStops]
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_LAYER_STYLE_GRADIENT_STOPS);
  colorStops.forEach((stop, index) => {
    const linear = color(stop.color);
    values.set([linear[0], linear[1], linear[2], stop.position], 24 + index * 4);
    values[88 + index * 4] = stop.midpoint;
  });
  opacityStops.forEach((stop, index) => {
    values.set([stop.position, stop.opacity, stop.midpoint, 0], 56 + index * 4);
  });
  values[8] = colorStops.length;
  values[9] = opacityStops.length;
  values[10] = gradient.smoothness;
  values[11] = gradient.type === 'noise' ? 1 : 0;
};

const writeContour = (
  values: Float32Array,
  contour: { points: readonly { position: number; value: number }[] }
) => {
  const points = [...contour.points]
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_LAYER_STYLE_CONTOUR_POINTS);
  points.forEach((point, index) => {
    values.set([point.position, point.value, 0, 0], 120 + index * 4);
  });
  values[22] = points.length;
};

export const baseLayerStyleUniform = (
  fillOpacity: number,
  width: number,
  height: number,
  blendProfile = 0,
  blendQuantization = 0
) => {
  const values = empty();
  values.set([0, 1, 0, fillOpacity], 0);
  values.set([width, height, 0, 0], 20);
  values[152] = blendProfile;
  values[153] = blendQuantization;
  return values;
};

export const layerStyleUniform = (
  effect: LayerStyleInstance,
  stack: LayerStyleStack,
  width: number,
  height: number,
  patternAvailable = true,
  quality: 'interactive' | 'final' = 'final',
  geometry: { x: number; y: number; width: number; height: number } = {
    x: 0, y: 0, width, height
  },
  blendProfile = 0,
  blendQuantization = 0
) => {
  if (!effect.enabled || effect.opacity <= 0) return null;
  const values = empty();
  const scale = stack.scale;
  const angle = 'useGlobalLight' in effect && effect.useGlobalLight
    ? stack.globalLight.angle
    : 'angle' in effect ? effect.angle : 0;
  const writeHeader = (kind: number, blendMode = effect.blendMode) =>
    values.set([kind, effect.opacity, blendModeGpuValue(blendMode), 1], 0);
  const writeColor0 = (value: { r: number; g: number; b: number; a: number }) =>
    values.set(color(value), 4);
  switch (effect.kind) {
    case 'color-overlay':
      writeHeader(1);
      writeColor0(effect.color);
      break;
    case 'drop-shadow':
      writeHeader(2);
      writeColor0(effect.color);
      values.set([angle, effect.distance * scale, effect.size * scale, effect.spread], 12);
      values.set([effect.layerKnocksOut ? 1 : 0, 0, 0, effect.noise], 16);
      writeContour(values, effect.contour);
      break;
    case 'inner-shadow':
      writeHeader(3);
      writeColor0(effect.color);
      values.set([angle, effect.distance * scale, effect.size * scale, effect.choke], 12);
      values.set([0, 0, 0, effect.noise], 16);
      writeContour(values, effect.contour);
      break;
    case 'outer-glow':
      writeHeader(effect.gradient ? 11 : 4);
      if (effect.gradient) writeGradient(values, effect.gradient);
      else writeColor0(effect.color);
      values.set([effect.technique === 'precise' ? 1 : 0, 0, effect.size * scale, effect.choke], 12);
      values.set([0, effect.range, effect.jitter, effect.noise], 16);
      writeContour(values, effect.contour);
      break;
    case 'inner-glow':
      writeHeader(effect.gradient ? 12 : 5);
      if (effect.gradient) writeGradient(values, effect.gradient);
      else writeColor0(effect.color);
      values.set([effect.technique === 'precise' ? 1 : 0, 0, effect.size * scale, effect.choke], 12);
      values.set([effect.source === 'center' ? 1 : 0, effect.range, effect.jitter, effect.noise], 16);
      writeContour(values, effect.contour);
      break;
    case 'stroke':
      if (
        effect.fill.type === 'pattern'
        && (!effect.fill.pattern?.assetId || !patternAvailable)
      ) return null;
      writeHeader(effect.fill.type === 'color' ? 6 : effect.fill.type === 'gradient' ? 10 : 14);
      if (effect.fill.type === 'color') {
        writeColor0(effect.fill.color);
      } else if (effect.fill.type === 'gradient') {
        writeGradient(values, effect.fill.gradient);
      }
      values.set([0, 0, effect.size * scale, 0], 12);
      values.set([
        effect.position === 'outside' ? 0 : effect.position === 'inside' ? 1 : 2,
        effect.fill.type === 'gradient'
          ? effect.fill.style === 'linear' ? 0
            : effect.fill.style === 'radial' ? 1
              : effect.fill.style === 'angle' ? 2
                : effect.fill.style === 'reflected' ? 3 : 4
          : 0,
        effect.fill.type === 'gradient' && effect.fill.dither ? 1 : 0,
        effect.fill.type === 'gradient' && effect.fill.reverse ? 1 : 0
      ], 16);
      if (effect.fill.type === 'gradient') {
        values[3] = effect.size * scale;
        values[12] = effect.fill.angle;
        values[13] = effect.fill.offsetX;
        values[14] = effect.fill.scale;
        values[15] = effect.fill.offsetY;
      } else if (effect.fill.type === 'pattern') {
        values[12] = effect.fill.angle;
        values[14] = effect.fill.scale;
      }
      break;
    case 'gradient-overlay': {
      writeHeader(7);
      writeGradient(values, effect.gradient);
      values.set([effect.angle, effect.offsetX, effect.scale, effect.offsetY], 12);
      values.set([
        effect.reverse ? 1 : 0,
        effect.style === 'linear' ? 0
          : effect.style === 'radial' ? 1
            : effect.style === 'angle' ? 2
              : effect.style === 'reflected' ? 3 : 4,
        effect.dither ? 1 : 0,
        effect.method === 'perceptual' ? 0
          : effect.method === 'linear' ? 1
            : effect.method === 'classic' ? 2 : 3
      ], 16);
      break;
    }
    case 'satin':
      writeHeader(8);
      writeColor0(effect.color);
      values.set([effect.angle, effect.distance * scale, effect.size * scale, 0], 12);
      values.set([effect.invert ? 1 : 0, 0, 0, 0], 16);
      writeContour(values, effect.contour);
      break;
    case 'bevel-emboss':
      writeHeader(9, effect.highlightMode);
      values[3] = effect.technique === 'smooth' ? 0
        : effect.technique === 'chisel-hard' ? 1 : 2;
      values.set([
        ...color({ ...effect.highlightColor, a: effect.highlightOpacity })
      ], 4);
      values.set([
        ...color({ ...effect.shadowColor, a: effect.shadowOpacity })
      ], 8);
      values.set([angle, effect.altitude, effect.size * scale, effect.depth], 12);
      values.set([
        effect.direction === 'down' ? 1 : 0,
        blendModeGpuValue(effect.shadowMode),
        effect.soften * scale,
        effect.style === 'outer-bevel' ? 0
          : effect.style === 'inner-bevel' ? 1
            : effect.style === 'emboss' ? 2
              : effect.style === 'pillow-emboss' ? 3 : 4
      ], 16);
      if (
        effect.texture.enabled
        && effect.texture.pattern?.assetId
        && patternAvailable
      ) {
        values.set([
          1,
          effect.texture.scale,
          effect.texture.depth,
          effect.texture.invert ? 1 : 0
        ], 24);
      }
      writeContour(values, effect.contour);
      break;
    case 'pattern-overlay':
      if (!effect.pattern?.assetId || !patternAvailable) return null;
      writeHeader(13);
      values.set([effect.angle, effect.offsetX, effect.scale, effect.offsetY], 12);
      break;
  }
  values[20] = width;
  values[21] = height;
  // Gradient midpoint vec4s reserve y/z/w. Keep the midpoint in x and use
  // those otherwise-unused lanes for transformed layer-local geometry.
  values[89] = geometry.x;
  values[90] = geometry.y;
  values[91] = geometry.width;
  values[93] = geometry.height;
  values[94] = effect.kind === 'gradient-overlay'
    ? effect.alignWithLayer ? 1 : 0
    : effect.kind === 'stroke' && effect.fill.type === 'gradient'
      ? effect.fill.alignWithLayer ? 1 : 0
      : 0;
  // Wide effects need more angular coverage to avoid visible concentric bands.
  // Interactive previews retain a lower cap; final rendering scales up to the
  // shader's complete 64-direction kernel without changing authored geometry.
  values[23] = adaptiveBlurSamples(effect, scale, quality);
  values[95] = values[23];
  values[152] = blendProfile;
  values[153] = blendQuantization;
  return values;
};
