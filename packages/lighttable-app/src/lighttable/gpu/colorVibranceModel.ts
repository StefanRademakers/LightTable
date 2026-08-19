export const COLOR_VIBRANCE_SKIN_MODEL = {
  hueCenter: 0.72,
  hueInnerRadius: 0.45,
  hueOuterRadius: 1.05,
  chromaFadeInStart: 0.008,
  chromaFadeInEnd: 0.045,
  chromaFadeOutStart: 0.24,
  chromaFadeOutEnd: 0.38,
  lightnessFadeInStart: 0.08,
  lightnessFadeInEnd: 0.25,
  lightnessFadeOutStart: 0.90,
  lightnessFadeOutEnd: 1.0,
  maximumProtection: 0.80
} as const;

const TAU = Math.PI * 2;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (left: number, right: number, value: number) => {
  const amount = clamp01((value - left) / (right - left));
  return amount * amount * (3 - 2 * amount);
};

export const colorVibranceHueDistance = (left: number, right: number) => {
  const distance = Math.abs(left - right) % TAU;
  return Math.min(distance, TAU - distance);
};

/** CPU reference for the soft OKLCH skin-like region used by the WGSL path. */
export const colorVibranceSkinProtection = (
  lightness: number,
  chroma: number,
  hue: number
) => {
  if (chroma < 0.000001) return 0;
  const model = COLOR_VIBRANCE_SKIN_MODEL;
  const hueWeight = 1 - smoothstep(
    model.hueInnerRadius,
    model.hueOuterRadius,
    colorVibranceHueDistance(hue, model.hueCenter)
  );
  const chromaWeight = smoothstep(model.chromaFadeInStart, model.chromaFadeInEnd, chroma)
    * (1 - smoothstep(model.chromaFadeOutStart, model.chromaFadeOutEnd, chroma));
  const lightnessWeight = smoothstep(
    model.lightnessFadeInStart, model.lightnessFadeInEnd, lightness
  ) * (1 - smoothstep(model.lightnessFadeOutStart, model.lightnessFadeOutEnd, lightness));
  return hueWeight * chromaWeight * lightnessWeight;
};

export const colorVibrancePositiveResponse = (
  lightness: number,
  chroma: number,
  hue: number
) => {
  const perceptualSaturation = chroma / Math.max(lightness, 0.08);
  const underSaturated = 1 - smoothstep(0.08, 0.42, perceptualSaturation);
  const skinProtection = colorVibranceSkinProtection(lightness, chroma, hue);
  return (0.28 + 0.92 * underSaturated)
    * (1 - COLOR_VIBRANCE_SKIN_MODEL.maximumProtection * skinProtection);
};
