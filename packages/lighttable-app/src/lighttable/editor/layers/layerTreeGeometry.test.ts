import { describe, expect, it } from 'vitest';
import {
  LAYER_TREE_GEOMETRY,
  layerRowInset
} from './layerTreeGeometry';

describe('layer tree geometry', () => {
  it('keeps thumbnail content inside a stable square cell', () => {
    expect(LAYER_TREE_GEOMETRY.thumbnailSlot).toBeGreaterThanOrEqual(
      LAYER_TREE_GEOMETRY.thumbnailContentMax
    );
    expect(LAYER_TREE_GEOMETRY.thumbnailSlot).toBe(42);
    expect(LAYER_TREE_GEOMETRY.rowPaddingBlock).toBe(0);
  });

  it('uses one depth increment for rows and clipping marks', () => {
    expect(layerRowInset(0)).toBe(5);
    expect(layerRowInset(2)).toBe(37);
  });

  it('clamps invalid negative and fractional depths', () => {
    expect(layerRowInset(-2)).toBe(5);
    expect(layerRowInset(1.9)).toBe(21);
  });
});
