import { describe, expect, it } from 'vitest';
import { selectionMaskFromLogits } from './smartSelectionMask';

describe('smart selection mask coverage', () => {
  it('keeps the interior opaque regardless of positive logit confidence', () => {
    const mask = selectionMaskFromLogits([
      0.01, 0.01, 0.01,
      0.01, 0.01, 0.01,
      0.01, 0.01, 0.01
    ], 0, 3, 3, false);
    expect([...mask]).toEqual(new Array(9).fill(255));
  });

  it('antialiases only the spatial boundary of a binary SAM decision', () => {
    const mask = selectionMaskFromLogits([
      -1, -1, -1,
      -1, 0.01, -1,
      -1, -1, -1
    ], 0, 3, 3, false);
    expect(mask[4]).toBeGreaterThan(0);
    expect(mask[4]).toBeLessThan(255);
    expect(mask[0]).toBeGreaterThan(0);
    expect(mask[0]).toBeLessThan(mask[4]);
  });

  it('uses the exact SAM decision boundary in hard-edge mode', () => {
    expect([...selectionMaskFromLogits([-0.01, 0, 0.01], 0, 3, 1, true)])
      .toEqual([0, 0, 255]);
  });

  it('respects channel offsets when converting model output', () => {
    expect([...selectionMaskFromLogits([-2, -2, 0.01, 0.01], 2, 2, 1, false)])
      .toEqual([255, 255]);
  });
});
