export type ScopeQuality = 'auto' | 'low' | 'medium' | 'high';
export type VectorscopeRange = 'all' | 'low' | 'mid' | 'high';

export interface ScopeSettings {
  quality: ScopeQuality;
  traceBrightness: number;
  vectorscopeRange: VectorscopeRange;
  vectorscopeSkinTone: boolean;
  vectorscopeZoom2x: boolean;
  vectorscopeGraticule: boolean;
}

export interface ScopeVisibility {
  histogram: boolean;
  hueDistribution: boolean;
  parade: boolean;
  vectorscope: boolean;
}

export const DEFAULT_SCOPE_SETTINGS: Readonly<ScopeSettings> = Object.freeze({
  quality: 'medium',
  traceBrightness: 100,
  vectorscopeRange: 'all',
  vectorscopeSkinTone: true,
  vectorscopeZoom2x: false,
  vectorscopeGraticule: true
});

export const DEFAULT_SCOPE_VISIBILITY: Readonly<ScopeVisibility> = Object.freeze({
  histogram: true,
  hueDistribution: true,
  parade: true,
  vectorscope: true
});

export const scopeQualityTarget = (quality: ScopeQuality, interactionActive: boolean) => {
  if (quality === 'low') return 256;
  if (quality === 'medium') return 512;
  if (quality === 'high') return 1024;
  return interactionActive ? 256 : 1024;
};

/** Build an aspect-preserving, whole-image sampling grid near target^2 samples. */
export const resolveScopeSampleGrid = (
  width: number,
  height: number,
  quality: ScopeQuality,
  interactionActive: boolean
) => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const target = scopeQualityTarget(quality, interactionActive);
  const scale = Math.min(1, target / Math.sqrt(safeWidth * safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  };
};

export const displayRgbToBt709CbCr = (red: number, green: number, blue: number) => {
  const y = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return {
    y,
    cb: (blue - y) / 1.8556,
    cr: (red - y) / 1.5748
  };
};

export const vectorscopePosition = (red: number, green: number, blue: number) => {
  const { cb, cr } = displayRgbToBt709CbCr(red, green, blue);
  return { x: 0.5 + cb, y: 0.5 - cr };
};

export const rgbParadeBin = (sourceX: number, value: number, channel: 0 | 1 | 2) => {
  const x = Math.round(Math.max(0, Math.min(1, sourceX)) * 255);
  const y = Math.round(Math.max(0, Math.min(1, value)) * 255);
  return { x, y, index: channel * 256 * 256 + y * 256 + x };
};

export const SKIN_TONE_REFERENCE_DEGREES = 123;

export const skinToneReferenceEnd = (radius = 0.46) => {
  const angle = (SKIN_TONE_REFERENCE_DEGREES * Math.PI) / 180;
  return {
    x: 0.5 + Math.cos(angle) * radius,
    y: 0.5 - Math.sin(angle) * radius
  };
};

export const VECTORSCOPE_TARGETS = [
  { label: 'R', rgb: [0.75, 0, 0] },
  { label: 'Mg', rgb: [0.75, 0, 0.75] },
  { label: 'B', rgb: [0, 0, 0.75] },
  { label: 'Cy', rgb: [0, 0.75, 0.75] },
  { label: 'G', rgb: [0, 0.75, 0] },
  { label: 'Yl', rgb: [0.75, 0.75, 0] }
] as const;

export const vectorscopeTargetPositions = () => VECTORSCOPE_TARGETS.map((target) => ({
  label: target.label,
  ...vectorscopePosition(target.rgb[0], target.rgb[1], target.rgb[2])
}));
