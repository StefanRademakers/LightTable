import { describe, expect, it } from 'vitest';
import { resolveScopeCanvasSize, scopeCanvasSizesEqual } from './scopeCanvasSize';

describe('scope canvas size', () => {
  it('resolves CSS dimensions at the device-pixel boundary', () => {
    expect(resolveScopeCanvasSize(319.6, 180.4, 2)).toEqual({
      width: 639,
      height: 361
    });
  });

  it('rejects panels that do not have drawable layout bounds yet', () => {
    expect(resolveScopeCanvasSize(0, 180, 2)).toBeNull();
    expect(resolveScopeCanvasSize(320, 0, 2)).toBeNull();
  });

  it('compares the dimensions WebGPU actually consumes', () => {
    const first = resolveScopeCanvasSize(320, 180, 1.5);
    const second = resolveScopeCanvasSize(320.2, 180.2, 1.5);

    expect(scopeCanvasSizesEqual(first, second)).toBe(true);
    expect(scopeCanvasSizesEqual(first, resolveScopeCanvasSize(321, 180, 1.5))).toBe(false);
  });
});
