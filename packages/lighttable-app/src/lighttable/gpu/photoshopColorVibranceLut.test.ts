import { describe, expect, it } from 'vitest';
import { createDefaultPhotoshopAdjustment } from '../photoshopAdjustments';
import {
  buildPhotoshopColorVibranceLuts,
  PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE
} from './photoshopColorVibranceLut';

describe('Photoshop Color and Vibrance response LUT', () => {
  it('builds compact neutral response volumes in RGB-fastest order', () => {
    const result = buildPhotoshopColorVibranceLuts(
      createDefaultPhotoshopAdjustment('color-vibrance')
    );
    expect(result.whiteBalance).toHaveLength(PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE ** 3 * 4);
    expect(result.color).toHaveLength(PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE ** 3 * 4);
    const index = (red: number, green: number, blue: number) => (
      red + green * PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE
      + blue * PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE ** 2
    ) * 4;
    for (const coordinate of [
      [0, 0, 0],
      [5, 2, 7],
      [PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE - 1, PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE - 1,
        PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE - 1]
    ] as const) {
      const offset = index(coordinate[0], coordinate[1], coordinate[2]);
      const expected = coordinate.map((value) => Math.round(
        value / (PHOTOSHOP_COLOR_VIBRANCE_LUT_SIZE - 1) * 255
      ));
      const whiteBalance = [...result.whiteBalance.slice(offset, offset + 4)];
      expected.forEach((value, channel) => {
        expect(Math.abs(whiteBalance[channel]! - value / 255)).toBeLessThanOrEqual(1 / 255 + 1e-7);
      });
      expect(whiteBalance[3]).toBe(1);
      const color = [...result.color.slice(offset, offset + 4)];
      expected.forEach((value, channel) => {
        expect(Math.abs(color[channel]! - value)).toBeLessThanOrEqual(1);
      });
      expect(color[3]).toBe(255);
    }
  });

  it('couples each slider pair while retaining opaque LUT voxels', () => {
    const settings = createDefaultPhotoshopAdjustment('color-vibrance');
    settings.colorVibranceTemperature = -91;
    settings.colorVibranceTint = 37;
    settings.colorVibranceVibrance = -44;
    settings.colorVibranceSaturation = 63;
    const result = buildPhotoshopColorVibranceLuts(settings);
    const neutral = buildPhotoshopColorVibranceLuts(
      createDefaultPhotoshopAdjustment('color-vibrance')
    );
    expect(result.whiteBalance).not.toEqual(neutral.whiteBalance);
    expect(result.color).not.toEqual(neutral.color);
    expect([...result.whiteBalance].filter((_, index) => index % 4 === 3)
      .every((value) => value === 1)).toBe(true);
    expect([...result.color].filter((_, index) => index % 4 === 3)
      .every((value) => value === 255)).toBe(true);
    expect([...result.whiteBalance].filter((_, index) => index % 4 !== 3)
      .some((value) => value < 0 || value > 1)).toBe(true);
  });
});
