export const BLEND_MODES = [
  { id: 'normal', label: 'Normal', gpuValue: 0 },
  { id: 'darken', label: 'Darken', gpuValue: 6 },
  { id: 'multiply', label: 'Multiply', gpuValue: 1 },
  { id: 'color-burn', label: 'Color Burn', gpuValue: 9 },
  { id: 'lighten', label: 'Lighten', gpuValue: 7 },
  { id: 'screen', label: 'Screen', gpuValue: 2 },
  { id: 'color-dodge', label: 'Color Dodge', gpuValue: 8 },
  { id: 'linear-dodge', label: 'Linear Dodge (Add)', gpuValue: 10 },
  { id: 'overlay', label: 'Overlay', gpuValue: 3 },
  { id: 'soft-light', label: 'Soft Light', gpuValue: 4 },
  { id: 'hard-light', label: 'Hard Light', gpuValue: 5 },
  { id: 'difference', label: 'Difference', gpuValue: 11 },
  { id: 'hue', label: 'Hue', gpuValue: 12 },
  { id: 'saturation', label: 'Saturation', gpuValue: 13 },
  { id: 'color', label: 'Color', gpuValue: 14 },
  { id: 'luminosity', label: 'Luminosity', gpuValue: 15 },
  { id: 'linear-burn', label: 'Linear Burn', gpuValue: 16 },
  { id: 'darker-color', label: 'Darker Color', gpuValue: 17 },
  { id: 'lighter-color', label: 'Lighter Color', gpuValue: 18 },
  { id: 'vivid-light', label: 'Vivid Light', gpuValue: 19 },
  { id: 'linear-light', label: 'Linear Light', gpuValue: 20 },
  { id: 'pin-light', label: 'Pin Light', gpuValue: 21 },
  { id: 'hard-mix', label: 'Hard Mix', gpuValue: 22 },
  { id: 'exclusion', label: 'Exclusion', gpuValue: 23 },
  { id: 'subtract', label: 'Subtract', gpuValue: 24 },
  { id: 'divide', label: 'Divide', gpuValue: 25 }
] as const;

export type BlendMode = typeof BLEND_MODES[number]['id'];

export const blendModeGpuValue = (mode: BlendMode) =>
  BLEND_MODES.find((candidate) => candidate.id === mode)?.gpuValue ?? 0;
