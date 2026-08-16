import { describe, expect, it } from 'vitest';
import { anchoredViewportMenuPosition } from './AnchoredViewportMenu';

describe('anchoredViewportMenuPosition', () => {
  it('opens above a footer trigger and clamps to the viewport', () => {
    expect(anchoredViewportMenuPosition(
      { left: 36, right: 62, top: 730, bottom: 756 },
      { width: 220, height: 680 },
      { width: 1280, height: 768 }
    )).toEqual({ left: 8, top: 44, maxHeight: 684, placement: 'above' });
  });

  it('flips below a top-edge trigger', () => {
    expect(anchoredViewportMenuPosition(
      { left: 400, right: 426, top: 10, bottom: 36 },
      { width: 220, height: 300 },
      { width: 800, height: 600 }
    )).toEqual({ left: 206, top: 42, maxHeight: 550, placement: 'below' });
  });
});
