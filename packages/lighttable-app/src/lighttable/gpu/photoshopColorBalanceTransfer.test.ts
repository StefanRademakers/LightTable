import { describe, expect, it } from 'vitest';
import {
  decodePhotoshopColorBalanceTransfer,
  PHOTOSHOP_COLOR_BALANCE_TRANSFER_ROWS,
  PHOTOSHOP_COLOR_BALANCE_TRANSFER_WIDTH
} from './photoshopColorBalanceTransfer';

describe('Photoshop Color Balance transfer calibration', () => {
  it('contains all three 21-knot transfer families with identity neutral rows', () => {
    const data = decodePhotoshopColorBalanceTransfer();
    expect(data).toHaveLength(
      PHOTOSHOP_COLOR_BALANCE_TRANSFER_WIDTH * PHOTOSHOP_COLOR_BALANCE_TRANSFER_ROWS
    );
    for (const tone of [0, 1, 2]) {
      const row = (tone * 21 + 10) * PHOTOSHOP_COLOR_BALANCE_TRANSFER_WIDTH;
      for (let input = 0; input < 256; input += 1) {
        expect(Math.abs(data[row + input]! - input)).toBeLessThanOrEqual(1);
      }
    }
  });
});
