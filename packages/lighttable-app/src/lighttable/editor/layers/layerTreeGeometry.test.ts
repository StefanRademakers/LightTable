import { describe, expect, it } from 'vitest';
import {
  LAYER_TREE_GEOMETRY,
  layerClippingMarkInset,
  layerRowInset
} from './layerTreeGeometry';

describe('layer tree geometry', () => {
  it('keeps thumbnail content inside a stable square cell', () => {
    expect(LAYER_TREE_GEOMETRY.thumbnailSlot).toBeGreaterThanOrEqual(
      LAYER_TREE_GEOMETRY.thumbnailContentMax
    );
    expect(LAYER_TREE_GEOMETRY.thumbnailSlot).toBe(42);
  });

  it('uses one depth increment for rows and clipping marks', () => {
    expect(layerRowInset(0, false)).toBe(5);
    expect(layerRowInset(2, false)).toBe(37);
    expect(layerRowInset(2, true)).toBe(51);
    expect(layerClippingMarkInset(2)).toBe(37);
  });

  it('clamps invalid negative and fractional depths', () => {
    expect(layerRowInset(-2, false)).toBe(5);
    expect(layerRowInset(1.9, false)).toBe(21);
  });
});
