import { MAX_POINT_COLOR_SAMPLES } from '../../pointColor';
import {
  PHOTOSHOP_ADJUSTMENT_KINDS
} from '../../photoshopAdjustments';
import {
  cloneAdjustments,
  createDefaultAdjustments,
  type BasicAdjustments
} from '../../types';
import { adjustmentNumberConstraint } from './adjustmentValueConstraints';

const MAX_NUMBER = 1_000_000;
const MAX_STRING = 512;

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
};

const ENUMS: Readonly<Record<string, readonly string[]>> = {
  'curves.interpolation': ['monotone', 'photoshop-natural'],
  'gradientMap.interpolation': ['classic', 'perceptual', 'linear', 'smooth'],
  'photoshopAdjustment.kind': PHOTOSHOP_ADJUSTMENT_KINDS,
  'photoshopAdjustment.levelsChannel': ['rgb', 'red', 'green', 'blue'],
  'photoshopAdjustment.hueSaturationChannel': [
    'master', 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'
  ],
  'photoshopAdjustment.colorBalanceTone': ['shadows', 'midtones', 'highlights'],
  'photoshopAdjustment.channelMixerOutput': ['red', 'green', 'blue'],
  'photoshopAdjustment.colorLookupPreset': [
    'none', 'film-stock', 'moonlight', 'teal-orange'
  ],
  'photoshopAdjustment.selectiveColorMethod': ['relative', 'absolute'],
  'effects.lensBlur.bokehShape': ['circle', 'hexagon', 'anamorphic', 'donut'],
  'effects.lensBlur.quality': ['balanced', 'high', 'ultra']
};

const finite = (value: unknown, min = -MAX_NUMBER, max = MAX_NUMBER) => (
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
);

const canonicalNumber = (value: unknown, path: string) => {
  const constraint = adjustmentNumberConstraint(path);
  return Boolean(constraint && finite(value, constraint.min, constraint.max)
    && (!constraint.integer || Number.isInteger(value)));
};

const validateLevels = (value: unknown, input: boolean): boolean => {
  if (!Array.isArray(value) || value.length !== (input ? 3 : 2)) return false;
  if (input) {
    const [black, gamma, white] = value;
    return Number.isInteger(black) && finite(black, 0, 254)
      && finite(gamma, 0.1, 9.99)
      && Number.isInteger(white) && finite(white, 1, 255)
      && Number(black) < Number(white);
  }
  const [black, white] = value;
  return Number.isInteger(black) && finite(black, 0, 255)
    && Number.isInteger(white) && finite(white, 0, 255)
    && Number(black) <= Number(white);
};

const validateCurve = (value: unknown): boolean => Array.isArray(value)
  && value.length >= 2 && value.length <= 32
  && value.every((point, index) => record(point)
    && exactKeys(point, ['x', 'y'])
    && finite(point.x, 0, 1) && finite(point.y, 0, 1)
    && (index === 0 || finite((value[index - 1] as Record<string, unknown>).x, 0, 1)
      && Number((value[index - 1] as Record<string, unknown>).x) < Number(point.x)));

const validateGradientStops = (value: unknown, opacity: boolean): boolean => (
  Array.isArray(value) && value.length >= 2 && value.length <= 8
  && value.every((stop) => {
    if (!record(stop) || !finite(stop.position, 0, 1) || !finite(stop.midpoint, 0, 1)) {
      return false;
    }
    if (opacity) return exactKeys(stop, ['position', 'midpoint', 'opacity'])
      && finite(stop.opacity, 0, 1);
    const color = stop.color;
    if (!exactKeys(stop, ['position', 'midpoint', 'color']) || !record(color)
      || !exactKeys(color, ['r', 'g', 'b'])) return false;
    return ['r', 'g', 'b'].every((channel) => finite(color[channel], 0, 1));
  })
);

const pointSampleShape = {
  id: '', lightness: 0, chroma: 0, hue: 0, hueShift: 0,
  saturationShift: 0, luminanceShift: 0, variance: 0, range: 0,
  hueRange: 0, saturationRange: 0, luminanceRange: 0
};

const validateNode = (value: unknown, shape: unknown, path: string): boolean => {
  if (path.startsWith('curves.') && path !== 'curves.interpolation') {
    return validateCurve(value);
  }
  if (path === 'gradientMap.colorStops') return validateGradientStops(value, false);
  if (path === 'gradientMap.opacityStops') return validateGradientStops(value, true);
  if (path === 'pointColor.samples') {
    return Array.isArray(value) && value.length <= MAX_POINT_COLOR_SAMPLES
      && value.every((sample) => validateNode(sample, pointSampleShape, `${path}[]`));
  }
  if (/^photoshopAdjustment\.levels\.[^.]+\.input$/.test(path)) {
    return validateLevels(value, true);
  }
  if (/^photoshopAdjustment\.levels\.[^.]+\.output$/.test(path)) {
    return validateLevels(value, false);
  }
  if (shape === null) {
    return value === null || (typeof value === 'string' && value.length <= MAX_STRING);
  }
  if (typeof shape === 'number') return canonicalNumber(value, path);
  if (typeof shape === 'boolean') return typeof value === 'boolean';
  if (typeof shape === 'string') {
    return typeof value === 'string' && value.length <= MAX_STRING
      && (path !== 'pointColor.samples[].id' || value.length > 0)
      && (!ENUMS[path] || ENUMS[path].includes(value));
  }
  if (Array.isArray(shape)) {
    return Array.isArray(value) && value.length === shape.length
      && value.every((entry, index) => validateNode(
        entry, shape[index] ?? shape[0], `${path}[]`
      ));
  }
  if (!record(shape) || !record(value) || !exactKeys(value, Object.keys(shape))) return false;
  return Object.keys(shape).every((key) => validateNode(
    value[key], shape[key], path ? `${path}.${key}` : key
  ));
};

/** Strict, bounded codec for externally replayable adjustment state. */
export const parseCompleteAdjustmentSnapshot = (value: unknown): BasicAdjustments | null => {
  const defaults = createDefaultAdjustments();
  if (!validateNode(value, defaults, '')) return null;
  try {
    return cloneAdjustments(value as BasicAdjustments);
  } catch {
    return null;
  }
};
