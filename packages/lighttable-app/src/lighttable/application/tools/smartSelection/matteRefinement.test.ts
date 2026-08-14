import { describe, expect, it } from 'vitest';
import {
  buildAdaptiveTrimap,
  constrainMatteContourExpansion,
  refineMatteFromLogits
} from './matteRefinement';

const rgba = (width: number, height: number, colorAt: (x: number, y: number) => readonly number[]) => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const color = colorAt(x, y);
    const offset = (y * width + x) * 4;
    data[offset] = color[0] ?? 0;
    data[offset + 1] = color[1] ?? 0;
    data[offset + 2] = color[2] ?? 0;
    data[offset + 3] = 255;
  }
  return { data, width, height, channels: 4 };
};

describe('matte refinement', () => {
  it('keeps certain foreground and background exact while producing a soft unknown band', () => {
    const width = 32;
    const height = 16;
    const logits = new Float32Array(width * height).fill(-4);
    for (let y = 3; y < 13; y += 1) for (let x = 7; x < 25; x += 1) logits[y * width + x] = 4;
    const image = rgba(width, height, (x) => x < 16 ? [20, 30, 40] : [225, 230, 235]);
    const alpha = refineMatteFromLogits(logits, 0, width, height, image, 'standard');
    expect(alpha[8 * width + 16]).toBe(255);
    expect(alpha[0]).toBe(0);
    expect([...alpha].some((value) => value > 0 && value < 255)).toBe(true);
  });

  it('limits work to a padded object ROI instead of the full document', () => {
    const width = 200;
    const height = 120;
    const logits = new Float32Array(width * height).fill(-2);
    for (let y = 50; y < 60; y += 1) for (let x = 90; x < 110; x += 1) logits[y * width + x] = 2;
    const { roi } = buildAdaptiveTrimap(logits, 0, width, height, 'high');
    expect(roi.x).toBeGreaterThan(0);
    expect(roi.y).toBeGreaterThan(0);
    expect(roi.width).toBeLessThan(width);
    expect(roi.height).toBeLessThan(height);
    expect(roi.x).toBeLessThanOrEqual(90);
    expect(roi.x + roi.width).toBeGreaterThanOrEqual(110);
  });

  it('keeps thin structures unknown instead of eroding them into certain background', () => {
    const width = 25;
    const height = 25;
    const logits = new Float32Array(width * height).fill(-3);
    for (let y = 4; y < 21; y += 1) logits[y * width + 12] = 3;
    const trimap = buildAdaptiveTrimap(logits, 0, width, height, 'standard');
    const localX = 12 - trimap.roi.x;
    const localY = 12 - trimap.roi.y;
    expect(trimap.data[localY * trimap.roi.width + localX]).toBe(128);
  });

  it('uses wider context and more soft-alpha samples at higher quality', () => {
    const width = 48;
    const height = 32;
    const logits = new Float32Array(width * height).fill(-2);
    for (let y = 8; y < 24; y += 1) for (let x = 12; x < 36; x += 1) logits[y * width + x] = 2;
    const image = rgba(width, height, (x, y) => [x * 5, y * 7, 128]);
    const fastTrimap = buildAdaptiveTrimap(logits, 0, width, height, 'fast');
    const highTrimap = buildAdaptiveTrimap(logits, 0, width, height, 'high');
    expect(highTrimap.roi.width * highTrimap.roi.height)
      .toBeGreaterThan(fastTrimap.roi.width * fastTrimap.roi.height);
    const fast = refineMatteFromLogits(logits, 0, width, height, image, 'fast');
    const high = refineMatteFromLogits(logits, 0, width, height, image, 'high');
    expect(high).not.toEqual(fast);
  });

  it('improves a shifted coarse contour against an RGB edge without blurring the interior', () => {
    const width = 64;
    const height = 20;
    const logits = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      logits[y * width + x] = (35 - x) / 3;
    }
    const image = rgba(width, height, (x) => x < 32 ? [30, 35, 40] : [230, 225, 220]);
    const alpha = refineMatteFromLogits(logits, 0, width, height, image, 'high');
    const row = 10 * width;
    expect(alpha[row + 10]).toBe(255);
    expect(alpha[row + 55]).toBe(0);
    expect(alpha[row + 31]).toBeGreaterThan(alpha[row + 34]);
  });

  it('limits hard neural contour expansion while preserving soft exterior alpha', () => {
    const width = 15;
    const height = 5;
    const logits = new Float32Array(width * height).fill(-8);
    for (let y = 1; y < 4; y += 1) for (let x = 6; x < 9; x += 1) {
      logits[y * width + x] = 8;
    }
    const result = constrainMatteContourExpansion(
      new Uint8Array(width * height).fill(220), logits, 0, width, height, 2
    );
    expect(result[2 * width + 4]).toBe(220);
    expect(result[2 * width + 3]).toBe(127);
    expect(result[2 * width + 12]).toBe(127);
  });
});
