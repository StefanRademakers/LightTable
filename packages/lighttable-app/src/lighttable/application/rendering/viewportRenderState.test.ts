import { describe, expect, it } from 'vitest';
import {
  resolveViewportImageRect,
  resolveViewportRenderState,
  viewportRenderStatesEqual
} from './viewportRenderState';

describe('viewport render state', () => {
  it('resolves centered image geometry with its authored pan in one calculation', () => {
    expect(resolveViewportImageRect(400, 200, 1000, 700, 2, 25, -10)).toEqual({
      x: 125,
      y: 140,
      width: 800,
      height: 400
    });
  });

  it('resolves canvas pixels and GPU uniforms once at the f32 boundary', () => {
    const state = resolveViewportRenderState(
      640.4,
      360.4,
      2,
      { x: 10.25, y: 20.5, width: 600.25, height: 320.5 }
    );

    expect(state.pixelWidth).toBe(1281);
    expect(state.pixelHeight).toBe(721);
    expect([...state.uniforms]).toEqual([
      1281, 721, 20.5, 41, 1200.5, 641, 24, 0
    ]);
  });

  it('treats distinct layout objects with identical GPU values as unchanged', () => {
    const first = resolveViewportRenderState(
      800,
      600,
      1.5,
      { x: 12, y: 8, width: 720, height: 540 }
    );
    const second = resolveViewportRenderState(
      800,
      600,
      1.5,
      { x: 12, y: 8, width: 720, height: 540 }
    );

    expect(viewportRenderStatesEqual(first, second)).toBe(true);
  });

  it('detects changes that affect either the canvas or presentation transform', () => {
    const initial = resolveViewportRenderState(
      800,
      600,
      1,
      { x: 0, y: 0, width: 800, height: 600 }
    );

    expect(viewportRenderStatesEqual(initial, resolveViewportRenderState(
      801,
      600,
      1,
      { x: 0, y: 0, width: 800, height: 600 }
    ))).toBe(false);
    expect(viewportRenderStatesEqual(initial, resolveViewportRenderState(
      800,
      600,
      1,
      { x: 1, y: 0, width: 800, height: 600 }
    ))).toBe(false);
  });

});
