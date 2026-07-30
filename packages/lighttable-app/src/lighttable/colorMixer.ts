export const COLOR_MIXER_CHANNELS = ['hue', 'saturation', 'luminance'] as const;
export type ColorMixerChannel = typeof COLOR_MIXER_CHANNELS[number];
export type ColorMixerMode = ColorMixerChannel | 'all';

export type ColorMixerValues = [number, number, number, number, number, number, number, number];

export interface ColorMixerAdjustments {
  hue: ColorMixerValues;
  saturation: ColorMixerValues;
  luminance: ColorMixerValues;
}

export interface ColorMixerRange {
  label: string;
  color: string;
}

export const COLOR_MIXER_RANGES: ReadonlyArray<ColorMixerRange> = [
  { label: 'Reds', color: '#df5b62' },
  { label: 'Oranges', color: '#da8242' },
  { label: 'Yellows', color: '#d2c94b' },
  { label: 'Greens', color: '#4db66c' },
  { label: 'Aquas', color: '#4bc2c3' },
  { label: 'Blues', color: '#5575dc' },
  { label: 'Purples', color: '#9358c8' },
  { label: 'Magentas', color: '#cf4eaa' }
];

// Perceptual OKLCH locations used by the GPU Color Mixer. They are deliberately
// not spaced at equal mathematical angles: the familiar editing ranges should
// follow where those colours appear in OKLCH rather than generic HSL sectors.
export const COLOR_MIXER_CENTERS = [
  0.5102,
  0.9211,
  1.9160,
  2.4870,
  -2.8846,
  -1.6747,
  -1.0368,
  -0.2838
] as const;

// The perceptual OKLCH centres above remapped to the familiar, continuous
// editor hue strip used by the Hue Distribution scope. Keeping this mapping
// shared lets the scope, range picker and GPU mixer point at the same colour.
export const COLOR_MIXER_DISPLAY_CENTERS = [
  0,
  1 / 12,
  1 / 6,
  1 / 3,
  1 / 2,
  2 / 3,
  55 / 72,
  7 / 8
] as const;

/**
 * CPU reference for the shader's periodic interpolating Shepard curve.
 * Positive normalized weights make the result a bounded blend, while inverse
 * chord distance makes every control hit its exact value at its own centre.
 */
export const evaluateColorMixerCurve = (hue: number, values: ColorMixerValues) => {
  let weightedValue = 0;
  let totalWeight = 0;
  for (let index = 0; index < COLOR_MIXER_CENTERS.length; index += 1) {
    const distance = 1 - Math.cos(hue - COLOR_MIXER_CENTERS[index]);
    if (distance < 1e-7) return values[index];
    const weight = 1 / Math.max(distance, 1e-7);
    weightedValue += values[index] * weight;
    totalWeight += weight;
  }
  return weightedValue / Math.max(totalWeight, 1e-7);
};

const createNeutralValues = (): ColorMixerValues => [0, 0, 0, 0, 0, 0, 0, 0];

export const createDefaultColorMixer = (): ColorMixerAdjustments => ({
  hue: createNeutralValues(),
  saturation: createNeutralValues(),
  luminance: createNeutralValues()
});

export const cloneColorMixer = (mixer: ColorMixerAdjustments): ColorMixerAdjustments => ({
  hue: [...mixer.hue] as ColorMixerValues,
  saturation: [...mixer.saturation] as ColorMixerValues,
  luminance: [...mixer.luminance] as ColorMixerValues
});

export const colorMixerTrack = (channel: ColorMixerChannel, index: number) => {
  const current = COLOR_MIXER_RANGES[index];
  const previous = COLOR_MIXER_RANGES[(index + COLOR_MIXER_RANGES.length - 1) % COLOR_MIXER_RANGES.length];
  const next = COLOR_MIXER_RANGES[(index + 1) % COLOR_MIXER_RANGES.length];
  if (channel === 'hue') {
    return `linear-gradient(to right, ${previous.color} 0%, ${current.color} 50%, ${next.color} 100%)`;
  }
  if (channel === 'saturation') {
    return `linear-gradient(to right, #5b6067 0%, ${current.color} 100%)`;
  }
  return `linear-gradient(to right, #383c42 0%, ${current.color} 50%, #f1f3f5 100%)`;
};
