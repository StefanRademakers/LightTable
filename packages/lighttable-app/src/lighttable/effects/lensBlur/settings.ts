export type BokehShape = 'circle' | 'hexagon' | 'anamorphic' | 'donut';
export const LENS_BLUR_QUALITIES = ['balanced', 'high', 'ultra'] as const;
export type LensBlurQuality = (typeof LENS_BLUR_QUALITIES)[number];

export const lensBlurQualitySampleCount = (quality: LensBlurQuality) => (
  quality === 'ultra' ? 128 : quality === 'high' ? 64 : 48
);

export interface LensBlurSettings {
  enabled: boolean;
  apertureSize: number;
  bokehShape: BokehShape;
  quality: LensBlurQuality;
  catEye: number;
  bokehBoost: number;
  focusDistance: number;
  depthOfField: number;
  transitionFeather: number;
}

export const DEFAULT_LENS_BLUR_SETTINGS: Readonly<LensBlurSettings> = Object.freeze({
  enabled: false,
  apertureSize: 42,
  bokehShape: 'circle',
  quality: 'high',
  catEye: 0,
  bokehBoost: 20,
  focusDistance: 0.5,
  depthOfField: 0.16,
  transitionFeather: 0.4
});

export const createDefaultLensBlurSettings = (): LensBlurSettings => ({ ...DEFAULT_LENS_BLUR_SETTINGS });
export const cloneLensBlurSettings = (settings: LensBlurSettings): LensBlurSettings => ({ ...settings });
export const lensBlurIsActive = (settings: LensBlurSettings) => (
  settings.enabled && settings.apertureSize > 0.00001
);

export const focusInterval = (settings: LensBlurSettings) => {
  const focusDistance = Math.max(0, Math.min(1, settings.focusDistance));
  const halfDepthOfField = Math.max(0, Math.min(1, settings.depthOfField)) * 0.5;
  return {
    start: Math.max(0, focusDistance - halfDepthOfField),
    end: Math.min(1, focusDistance + halfDepthOfField)
  };
};

export const calculateSignedCircleOfConfusion = (depth: number, settings: LensBlurSettings) => {
  const { start, end } = focusInterval(settings);
  const feather = Math.max(0.001, settings.transitionFeather);
  if (depth > end) return Math.min(1, (depth - end) / feather);
  if (depth < start) return -Math.min(1, (start - depth) / feather);
  return 0;
};
