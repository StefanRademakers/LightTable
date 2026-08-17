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
    for (const coordinate of [[0, 0, 0], [4, 2, 7], [8, 8, 8]] as const) {
      const offset = index(coordinate[0], coordinate[1], coordinate[2]);
      const expected = coordinate.map((value) => Math.round(value / 8 * 255));
      expect([...result.whiteBalance.slice(offset, offset + 4)])
        .toEqual([...expected, 255]);
      expect([...result.color.slice(offset, offset + 4)])
        .toEqual([...expected, 255]);
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
      .every((value) => value === 255)).toBe(true);
    expect([...result.color].filter((_, index) => index % 4 === 3)
      .every((value) => value === 255)).toBe(true);
  });
});
