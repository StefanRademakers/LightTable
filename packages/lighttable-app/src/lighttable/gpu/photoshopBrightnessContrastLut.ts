import {
  PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE,
  PHOTOSHOP_BRIGHTNESS_CURVES,
  PHOTOSHOP_BRIGHTNESS_PARAMETER_KNOTS,
  PHOTOSHOP_NEGATIVE_CONTRAST_CURVE,
  PHOTOSHOP_POSITIVE_CONTRAST_CURVE
} from './photoshopBrightnessContrastLut.generated';

export { PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE } from './photoshopBrightnessContrastLut.generated';

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const sampleMeasuredCurve = (
  curve: ArrayLike<number>,
  value: number,
  offset = 0
) => {
  const code = clamp(value, 0, 1) * 255;
  const index = code < 252 ? Math.floor(code / 4) : 63;
  const fraction = code < 252 ? code / 4 - index : (code - 252) / 3;
  return (curve[offset + index]! * (1 - fraction) + curve[offset + index + 1]! * fraction) / 255;
};

/**
 * Builds the measured Photoshop 27.11 Brightness/Contrast transfer curve.
 * Photoshop composes protected Brightness first and its S-curve Contrast
 * second. Calibration knots are interpolated in float so LightTable keeps its
 * high-precision working path rather than reproducing Photoshop's 8-bit bands.
 */
export const buildPhotoshopBrightnessContrastLut = (
  brightness: number,
  contrast: number
): Float32Array => {
  const boundedBrightness = clamp(brightness, -150, 150);
  const parameterPosition = (boundedBrightness + 150) / 25;
  const leftParameter = Math.min(
    PHOTOSHOP_BRIGHTNESS_PARAMETER_KNOTS.length - 2,
    Math.floor(parameterPosition)
  );
  const parameterFraction = parameterPosition - leftParameter;
  const leftOffset = leftParameter * PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE;
  const rightOffset = leftOffset + PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE;
  const contrastCurve = contrast < 0
    ? PHOTOSHOP_NEGATIVE_CONTRAST_CURVE
    : PHOTOSHOP_POSITIVE_CONTRAST_CURVE;
  const contrastAmount = contrast < 0
    ? clamp(-contrast / 50, 0, 1)
    : clamp(contrast / 100, 0, 1);
  const result = new Float32Array(PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE);
  for (let index = 0; index < result.length; index += 1) {
    const brightnessCode = PHOTOSHOP_BRIGHTNESS_CURVES[leftOffset + index]! * (1 - parameterFraction)
      + PHOTOSHOP_BRIGHTNESS_CURVES[rightOffset + index]! * parameterFraction;
    const brightnessValue = brightnessCode / 255;
    const contrastValue = sampleMeasuredCurve(contrastCurve, brightnessValue);
    result[index] = brightnessValue + (contrastValue - brightnessValue) * contrastAmount;
  }
  return result;
};
