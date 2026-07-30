export const COLOR_GRADING_ZONES = ['global', 'shadows', 'midtones', 'highlights'] as const;
export type ColorGradingZone = typeof COLOR_GRADING_ZONES[number];
export type ColorGradingMode = ColorGradingZone | 'all';
export type ColorGradingValues = [number, number, number, number];

export interface ColorGradingAdjustments {
  hue: ColorGradingValues;
  saturation: ColorGradingValues;
  luminance: ColorGradingValues;
  blending: number;
  balance: number;
}

export const COLOR_GRADING_ZONE_LABELS: Record<ColorGradingZone, string> = {
  global: 'Global',
  shadows: 'Shadows',
  midtones: 'Midtones',
  highlights: 'Highlights'
};

export const colorGradingZoneIndex = (zone: ColorGradingZone) => COLOR_GRADING_ZONES.indexOf(zone);

export const createDefaultColorGrading = (): ColorGradingAdjustments => ({
  hue: [0, 0, 0, 0],
  saturation: [0, 0, 0, 0],
  luminance: [0, 0, 0, 0],
  blending: 50,
  balance: 0
});

export const cloneColorGrading = (grading: ColorGradingAdjustments): ColorGradingAdjustments => ({
  hue: [...grading.hue] as ColorGradingValues,
  saturation: [...grading.saturation] as ColorGradingValues,
  luminance: [...grading.luminance] as ColorGradingValues,
  blending: grading.blending,
  balance: grading.balance
});

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const smoothstep = (minimum: number, maximum: number, value: number) => {
  const normalized = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
};

/** CPU references for the grading mask math implemented in WGSL. */
export const colorGradingTonalPosition = (linearLuminance: number) => (
  clamp(Math.max(linearLuminance, 0) ** 0.4101205819, 0, 1)
);

export const colorGradingMasks = (position: number, blending: number, balance: number): [number, number, number] => {
  const balancedPosition = clamp(position + clamp(balance / 100, -1, 1) * 0.22, 0, 1);
  const width = 0.14 + (0.42 - 0.14) * clamp(blending / 100, 0, 1);
  const centers = [0, 0.5, 1] as const;
  const widths = [width, width * 0.82, width] as const;
  const weights = centers.map((center, index) => {
    const distance = (balancedPosition - center) / widths[index];
    return Math.exp(-(distance * distance));
  });
  const total = Math.max(weights[0] + weights[1] + weights[2], 1e-6);
  return [weights[0] / total, weights[1] / total, weights[2] / total];
};

export const colorGradingEndpointGuard = (position: number) => (
  smoothstep(0, 0.045, position) * (1 - smoothstep(0.94, 1, position))
);
