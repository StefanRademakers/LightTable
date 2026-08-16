import { describe, expect, it } from 'vitest';
import {
  buildPhotoshopBrightnessContrastLut,
  PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE
} from './photoshopBrightnessContrastLut';

const sample = (lut: Float32Array, inputCode: number) => {
  if (inputCode >= 252) {
    const fraction = (inputCode - 252) / 3;
    return (lut[63]! * (1 - fraction) + lut[64]! * fraction) * 255;
  }
  const position = inputCode / 4;
  const left = Math.floor(position);
  const fraction = position - left;
  return (lut[left]! * (1 - fraction) + lut[left + 1]! * fraction) * 255;
};

describe('Photoshop Brightness/Contrast measured transfer', () => {
  it('keeps neutral exactly neutral in high precision', () => {
    const lut = buildPhotoshopBrightnessContrastLut(0, 0);
    expect(lut).toHaveLength(PHOTOSHOP_BRIGHTNESS_CONTRAST_LUT_SIZE);
    for (const input of [0, 1, 64, 128, 192, 254, 255]) {
      expect(sample(lut, input)).toBeCloseTo(input, 4);
    }
  });

  it.each([
    { brightness: 30, contrast: 0, input: 128, photoshop: 154 },
    { brightness: -120, contrast: 0, input: 128, photoshop: 60 },
    { brightness: 0, contrast: 80, input: 64, photoshop: 45 },
    { brightness: 120, contrast: 80, input: 64, photoshop: 141 },
    { brightness: -120, contrast: -40, input: 192, photoshop: 104 }
  ])('matches a Photoshop 27.11 holdout within three codes: $brightness/$contrast at $input', ({
    brightness, contrast, input, photoshop
  }) => {
    expect(Math.abs(
      sample(buildPhotoshopBrightnessContrastLut(brightness, contrast), input) - photoshop
    )).toBeLessThanOrEqual(3);
  });
});
