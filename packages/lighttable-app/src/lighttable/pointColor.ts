export const MAX_POINT_COLOR_SAMPLES = 8;

export interface PointColorSample {
  readonly id: string;
  /** Sampled OKLab lightness, chroma and hue in radians. */
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
  readonly hueShift: number;
  readonly saturationShift: number;
  readonly luminanceShift: number;
  /** Pulls nearby colors toward (-) or pushes them away from (+) the sample. */
  readonly variance: number;
  /** Overall reach plus independently refinable H, C and L dimensions. */
  readonly range: number;
  readonly hueRange: number;
  readonly saturationRange: number;
  readonly luminanceRange: number;
}

export interface PointColorAdjustments {
  readonly samples: readonly PointColorSample[];
}

export const createDefaultPointColor = (): PointColorAdjustments => ({ samples: [] });

export const createPointColorSample = (
  id: string,
  lightness: number,
  chroma: number,
  hue: number
): PointColorSample => ({
  id,
  lightness,
  chroma,
  hue,
  hueShift: 0,
  saturationShift: 0,
  luminanceShift: 0,
  variance: 0,
  range: 50,
  hueRange: 50,
  saturationRange: 50,
  luminanceRange: 50
});

export const clonePointColor = (value: PointColorAdjustments): PointColorAdjustments => ({
  samples: value.samples.slice(0, MAX_POINT_COLOR_SAMPLES).map((sample) => ({ ...sample }))
});

export const pointColorIsActive = (value: PointColorAdjustments) => value.samples.some((sample) =>
  Math.abs(sample.hueShift) > 1e-6
  || Math.abs(sample.saturationShift) > 1e-6
  || Math.abs(sample.luminanceShift) > 1e-6
  || Math.abs(sample.variance) > 1e-6
);

export const pointColorSampleCss = (sample: PointColorSample) => {
  const rgb = oklabToLinearRgb([
    sample.lightness,
    Math.cos(sample.hue) * sample.chroma,
    Math.sin(sample.hue) * sample.chroma
  ]).map((channel) => Math.round(
    Math.min(1, Math.max(0, linearChannelToSrgb(channel))) * 255
  ));
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
};
import { linearChannelToSrgb, oklabToLinearRgb } from './colorMath';
