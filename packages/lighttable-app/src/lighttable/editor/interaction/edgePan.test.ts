import { describe, expect, it } from 'vitest';
import { edgePanFrameDelta, edgePanVelocity } from './edgePan';

describe('edgePan', () => {
  it('accelerates at all four edges and combines corners', () => {
    expect(edgePanVelocity(16, 0, 400)).toBe(450);
    expect(edgePanVelocity(384, 0, 400)).toBe(-450);
    expect(edgePanFrameDelta({
      clientX: 0, clientY: 0,
      viewportLeft: 0, viewportTop: 0, viewportWidth: 400, viewportHeight: 300,
      imageX: -100, imageY: -80, imageWidth: 600, imageHeight: 500,
      elapsedMs: 16
    })).toEqual({ x: 14.4, y: 14.4 });
  });

  it('stops exactly at the document presentation boundary', () => {
    expect(edgePanFrameDelta({
      clientX: 400, clientY: 300,
      viewportLeft: 0, viewportTop: 0, viewportWidth: 400, viewportHeight: 300,
      imageX: -1, imageY: -2, imageWidth: 402, imageHeight: 304,
      elapsedMs: 32
    })).toEqual({ x: -1, y: -2 });
  });
});
