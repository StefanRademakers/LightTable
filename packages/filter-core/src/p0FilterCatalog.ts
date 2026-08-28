import type { FilterPackContract } from './filterRegistry';
import {
  numberFilterControl as number,
  selectFilterControl as select,
  type FilterControlDefinition
} from './filterControls';

export type P0FilterKind =
  | 'gaussian-blur'
  | 'motion-blur'
  | 'surface-blur'
  | 'displace'
  | 'median'
  | 'reduce-noise'
  | 'smart-sharpen'
  | 'unsharp-mask'
  | 'high-pass'
  | 'maximum'
  | 'minimum'
  | 'offset';

export type FilterEdgeMode = 'transparent' | 'clamp' | 'wrap';
export type FilterInterpolation = 'bilinear' | 'bicubic';
export type MorphologyShape = 'square' | 'round';
export type SmartSharpenRemove = 'gaussian' | 'lens' | 'motion';

export interface P0FilterSettingsMap {
  'gaussian-blur': { radius: number };
  'motion-blur': { angle: number; distance: number };
  'surface-blur': { radius: number; threshold: number };
  'displace': {
    horizontalScale: number;
    verticalScale: number;
    mapAssetId: string | null;
    edgeMode: FilterEdgeMode;
    interpolation: FilterInterpolation;
  };
  'median': { radius: number };
  'reduce-noise': {
    strength: number;
    preserveDetails: number;
    reduceColorNoise: number;
    sharpenDetails: number;
  };
  'smart-sharpen': {
    amount: number;
    radius: number;
    reduceNoise: number;
    remove: SmartSharpenRemove;
    angle: number;
  };
  'unsharp-mask': { amount: number; radius: number; threshold: number };
  'high-pass': { radius: number };
  'maximum': { radius: number; shape: MorphologyShape };
  'minimum': { radius: number; shape: MorphologyShape };
  'offset': { horizontal: number; vertical: number; edgeMode: FilterEdgeMode };
}

export type P0FilterSettings = P0FilterSettingsMap[P0FilterKind];

export interface P0FilterDefinition<K extends P0FilterKind = P0FilterKind> {
  readonly kind: K;
  readonly moduleType: `lt.${K}`;
  readonly label: string;
  readonly menuLabel: string;
  readonly menuGroup: 'blur' | 'distort' | 'noise' | 'sharpen' | 'other';
  readonly defaults: Readonly<P0FilterSettingsMap[K]>;
  readonly controls: readonly FilterControlDefinition[];
  readonly alphaBehavior: 'preserve' | 'modify';
  readonly coordinateSpace: 'layer' | 'document';
  readonly psdCandidate?: string;
}

const edgeOptions = [
  { value: 'transparent', label: 'Transparent' },
  { value: 'clamp', label: 'Repeat Edge Pixels' },
  { value: 'wrap', label: 'Wrap Around' }
] as const;

export const P0_FILTER_DEFINITIONS = [
  {
    kind: 'gaussian-blur', moduleType: 'lt.gaussian-blur', label: 'Gaussian Blur',
    menuLabel: 'Gaussian Blur...', menuGroup: 'blur', defaults: { radius: 8 },
    controls: [number('radius', 'Radius', 0, 100, 0.1, 'px')],
    alphaBehavior: 'modify', coordinateSpace: 'document',
    psdCandidate: 'smart-filter:gaussian-blur'
  },
  {
    kind: 'motion-blur', moduleType: 'lt.motion-blur', label: 'Motion Blur',
    menuLabel: 'Motion Blur...', menuGroup: 'blur', defaults: { angle: 0, distance: 10 },
    controls: [number('angle', 'Angle', -180, 180, 0.1, 'deg'), number('distance', 'Distance', 0, 512, 0.1, 'px')],
    alphaBehavior: 'modify', coordinateSpace: 'document', psdCandidate: 'smart-filter:motion-blur'
  },
  {
    kind: 'surface-blur', moduleType: 'lt.surface-blur', label: 'Surface Blur',
    menuLabel: 'Surface Blur...', menuGroup: 'blur', defaults: { radius: 5, threshold: 15 },
    controls: [number('radius', 'Radius', 1, 100, 0.1, 'px'), number('threshold', 'Threshold', 2, 255, 1)],
    alphaBehavior: 'modify', coordinateSpace: 'document'
  },
  {
    kind: 'displace', moduleType: 'lt.displace', label: 'Displace',
    menuLabel: 'Displace...', menuGroup: 'distort',
    defaults: { horizontalScale: 10, verticalScale: 10, mapAssetId: null, edgeMode: 'clamp', interpolation: 'bicubic' },
    controls: [
      number('horizontalScale', 'Horizontal Scale', -999, 999, 0.1, 'px'),
      number('verticalScale', 'Vertical Scale', -999, 999, 0.1, 'px'),
      { type: 'asset', key: 'mapAssetId', label: 'Displacement Map', acceptedKinds: ['raster'] },
      select('edgeMode', 'Undefined Areas', edgeOptions),
      select('interpolation', 'Interpolation', [
        { value: 'bilinear', label: 'Bilinear' }, { value: 'bicubic', label: 'Bicubic' }
      ])
    ],
    alphaBehavior: 'preserve', coordinateSpace: 'layer', psdCandidate: 'smart-filter:displace'
  },
  {
    kind: 'median', moduleType: 'lt.median', label: 'Median', menuLabel: 'Median...',
    menuGroup: 'noise', defaults: { radius: 1 }, controls: [number('radius', 'Radius', 1, 100, 1, 'px')],
    alphaBehavior: 'modify', coordinateSpace: 'document', psdCandidate: 'smart-filter:median'
  },
  {
    kind: 'reduce-noise', moduleType: 'lt.reduce-noise', label: 'Reduce Noise',
    menuLabel: 'Reduce Noise...', menuGroup: 'noise',
    defaults: { strength: 6, preserveDetails: 60, reduceColorNoise: 45, sharpenDetails: 25 },
    controls: [
      number('strength', 'Strength', 0, 10, 1),
      number('preserveDetails', 'Preserve Details', 0, 100, 1, '%'),
      number('reduceColorNoise', 'Reduce Color Noise', 0, 100, 1, '%'),
      number('sharpenDetails', 'Sharpen Details', 0, 100, 1, '%')
    ],
    alphaBehavior: 'preserve', coordinateSpace: 'document', psdCandidate: 'smart-filter:reduce-noise'
  },
  {
    kind: 'smart-sharpen', moduleType: 'lt.smart-sharpen', label: 'Smart Sharpen',
    menuLabel: 'Smart Sharpen...', menuGroup: 'sharpen',
    defaults: { amount: 100, radius: 1, reduceNoise: 10, remove: 'gaussian', angle: 0 },
    controls: [
      number('amount', 'Amount', 0, 500, 1, '%'), number('radius', 'Radius', 0.1, 64, 0.1, 'px'),
      number('reduceNoise', 'Reduce Noise', 0, 100, 1, '%'),
      select('remove', 'Remove', [
        { value: 'gaussian', label: 'Gaussian Blur' },
        { value: 'lens', label: 'Lens Blur' },
        { value: 'motion', label: 'Motion Blur' }
      ]),
      number('angle', 'Angle', -180, 180, 0.1, 'deg')
    ],
    alphaBehavior: 'preserve', coordinateSpace: 'document', psdCandidate: 'smart-filter:smart-sharpen'
  },
  {
    kind: 'unsharp-mask', moduleType: 'lt.unsharp-mask', label: 'Unsharp Mask',
    menuLabel: 'Unsharp Mask...', menuGroup: 'sharpen', defaults: { amount: 100, radius: 1, threshold: 0 },
    controls: [
      number('amount', 'Amount', 0, 500, 1, '%'), number('radius', 'Radius', 0.1, 100, 0.1, 'px'),
      number('threshold', 'Threshold', 0, 255, 1)
    ],
    alphaBehavior: 'preserve', coordinateSpace: 'document', psdCandidate: 'smart-filter:unsharp-mask'
  },
  {
    kind: 'high-pass', moduleType: 'lt.high-pass', label: 'High Pass', menuLabel: 'High Pass...',
    menuGroup: 'other', defaults: { radius: 10 }, controls: [number('radius', 'Radius', 0.1, 100, 0.1, 'px')],
    alphaBehavior: 'preserve', coordinateSpace: 'document', psdCandidate: 'smart-filter:high-pass'
  },
  {
    kind: 'maximum', moduleType: 'lt.maximum', label: 'Maximum', menuLabel: 'Maximum...',
    menuGroup: 'other', defaults: { radius: 1, shape: 'round' },
    controls: [number('radius', 'Radius', 1, 500, 1, 'px'), select('shape', 'Preserve', [
      { value: 'round', label: 'Roundness' }, { value: 'square', label: 'Squareness' }
    ])],
    alphaBehavior: 'modify', coordinateSpace: 'document', psdCandidate: 'smart-filter:maximum'
  },
  {
    kind: 'minimum', moduleType: 'lt.minimum', label: 'Minimum', menuLabel: 'Minimum...',
    menuGroup: 'other', defaults: { radius: 1, shape: 'round' },
    controls: [number('radius', 'Radius', 1, 500, 1, 'px'), select('shape', 'Preserve', [
      { value: 'round', label: 'Roundness' }, { value: 'square', label: 'Squareness' }
    ])],
    alphaBehavior: 'modify', coordinateSpace: 'document', psdCandidate: 'smart-filter:minimum'
  },
  {
    kind: 'offset', moduleType: 'lt.offset', label: 'Offset', menuLabel: 'Offset...',
    menuGroup: 'other', defaults: { horizontal: 0, vertical: 0, edgeMode: 'wrap' },
    controls: [
      number('horizontal', 'Horizontal', -100000, 100000, 1, 'px'),
      number('vertical', 'Vertical', -100000, 100000, 1, 'px'),
      select('edgeMode', 'Undefined Areas', edgeOptions)
    ],
    alphaBehavior: 'preserve', coordinateSpace: 'layer', psdCandidate: 'smart-filter:offset'
  }
] as const satisfies readonly P0FilterDefinition[];

const definitionMap = new Map(P0_FILTER_DEFINITIONS.map((definition) => [definition.kind, definition]));
const moduleMap = new Map(P0_FILTER_DEFINITIONS.map((definition) => [definition.moduleType, definition]));

export const isP0FilterKind = (value: unknown): value is P0FilterKind =>
  typeof value === 'string' && definitionMap.has(value as P0FilterKind);

export const p0FilterDefinition = <K extends P0FilterKind>(kind: K): P0FilterDefinition<K> =>
  definitionMap.get(kind)! as unknown as P0FilterDefinition<K>;

export const p0FilterDefinitionForModule = (moduleType: string): P0FilterDefinition | null =>
  moduleMap.get(moduleType as `lt.${P0FilterKind}`) ?? null;

const finite = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamped = (value: unknown, fallback: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, finite(value, fallback)));

const choice = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback;

/** Fail-safe normalization used at every file, command and renderer boundary. */
export const normalizeP0FilterSettings = <K extends P0FilterKind>(
  kind: K,
  value: unknown
): P0FilterSettingsMap[K] => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  switch (kind) {
    case 'gaussian-blur': return { radius: clamped(source.radius, 8, 0, 100) } as P0FilterSettingsMap[K];
    case 'motion-blur': return {
      angle: clamped(source.angle, 0, -180, 180), distance: clamped(source.distance, 10, 0, 512)
    } as P0FilterSettingsMap[K];
    case 'surface-blur': return {
      radius: clamped(source.radius, 5, 1, 100), threshold: clamped(source.threshold, 15, 2, 255)
    } as P0FilterSettingsMap[K];
    case 'displace': return {
      horizontalScale: clamped(source.horizontalScale, 10, -999, 999),
      verticalScale: clamped(source.verticalScale, 10, -999, 999),
      mapAssetId: typeof source.mapAssetId === 'string' && source.mapAssetId ? source.mapAssetId : null,
      edgeMode: choice(source.edgeMode, ['transparent', 'clamp', 'wrap'], 'clamp'),
      interpolation: choice(source.interpolation, ['bilinear', 'bicubic'], 'bicubic')
    } as P0FilterSettingsMap[K];
    case 'median': return { radius: Math.round(clamped(source.radius, 1, 1, 100)) } as P0FilterSettingsMap[K];
    case 'reduce-noise': return {
      strength: Math.round(clamped(source.strength, 6, 0, 10)),
      preserveDetails: clamped(source.preserveDetails, 60, 0, 100),
      reduceColorNoise: clamped(source.reduceColorNoise, 45, 0, 100),
      sharpenDetails: clamped(source.sharpenDetails, 25, 0, 100)
    } as P0FilterSettingsMap[K];
    case 'smart-sharpen': return {
      amount: clamped(source.amount, 100, 0, 500), radius: clamped(source.radius, 1, 0.1, 64),
      reduceNoise: clamped(source.reduceNoise, 10, 0, 100),
      remove: choice(source.remove, ['gaussian', 'lens', 'motion'], 'gaussian'),
      angle: clamped(source.angle, 0, -180, 180)
    } as P0FilterSettingsMap[K];
    case 'unsharp-mask': return {
      amount: clamped(source.amount, 100, 0, 500), radius: clamped(source.radius, 1, 0.1, 100),
      threshold: clamped(source.threshold, 0, 0, 255)
    } as P0FilterSettingsMap[K];
    case 'high-pass': return { radius: clamped(source.radius, 10, 0.1, 100) } as P0FilterSettingsMap[K];
    case 'maximum':
    case 'minimum': return {
      radius: Math.round(clamped(source.radius, 1, 1, 500)),
      shape: choice(source.shape, ['square', 'round'], 'round')
    } as P0FilterSettingsMap[K];
    case 'offset': return {
      horizontal: Math.round(clamped(source.horizontal, 0, -100000, 100000)),
      vertical: Math.round(clamped(source.vertical, 0, -100000, 100000)),
      edgeMode: choice(source.edgeMode, ['transparent', 'clamp', 'wrap'], 'wrap')
    } as P0FilterSettingsMap[K];
  }
};

export const defaultP0FilterSettings = <K extends P0FilterKind>(kind: K): P0FilterSettingsMap[K] =>
  normalizeP0FilterSettings(kind, p0FilterDefinition(kind).defaults);

export const P0_FILTER_PACK: FilterPackContract<P0FilterDefinition> = Object.freeze({
  id: 'p0',
  maturity: 'stable',
  definitions: P0_FILTER_DEFINITIONS,
  normalize: (kind: string, value: unknown) => {
    if (!isP0FilterKind(kind)) throw new Error(`Unknown P0 filter kind: ${kind}`);
    return normalizeP0FilterSettings(kind, value);
  }
});

export type {
  AssetFilterControl,
  FilterControlDefinition,
  NumberFilterControl,
  SelectFilterControl
} from './filterControls';
