import { describe, expect, it } from 'vitest';
import { placeToolOptionsContextMenu } from './ToolOptionsContextMenu';

describe('placeToolOptionsContextMenu', () => {
  it('opens eight pixels to the right of the pointer when space is available', () => {
    expect(placeToolOptionsContextMenu({
      x: 100,
      y: 120,
      width: 320,
      height: 240,
      viewportWidth: 1000,
      viewportHeight: 800
    })).toEqual({ x: 108, y: 120 });
  });

  it('flips left and clamps vertically near the bottom-right edge', () => {
    expect(placeToolOptionsContextMenu({
      x: 980,
      y: 760,
      width: 320,
      height: 240,
      viewportWidth: 1000,
      viewportHeight: 800
    })).toEqual({ x: 652, y: 552 });
  });

  it('keeps an oversized menu within the eight-pixel leading edge', () => {
    expect(placeToolOptionsContextMenu({
      x: 4,
      y: 3,
      width: 1200,
      height: 900,
      viewportWidth: 1000,
      viewportHeight: 800
    })).toEqual({ x: 8, y: 8 });
  });
});
