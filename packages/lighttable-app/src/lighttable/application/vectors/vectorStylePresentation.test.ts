import { describe, expect, it } from 'vitest';
import { createVectorLiveShape } from '@lighttable/vector-core';
import {
  cssHexToLinearRgba,
  linearRgbaToCssHex,
  patchVectorStyle,
  vectorElementStyleSettings
} from './vectorStylePresentation';

describe('vector style presentation', () => {
  it('round-trips UI colors through the linear document color domain', () => {
    const linear = cssHexToLinearRgba('#4080c0');
    expect(linearRgbaToCssHex(linear)).toBe('#4080c0');
  });

  it('projects and patches an existing element style without losing stroke semantics', () => {
    const element = createVectorLiveShape('shape', {
      kind: 'ellipse',
      width: 20,
      height: 10
    });
    element.style.stroke = {
      paint: { type: 'solid', color: cssHexToLinearRgba('#ffffff') },
      width: 3,
      alignment: 'outside',
      cap: 'square',
      join: 'bevel',
      miterLimit: 7,
      dash: [2, 4],
      dashOffset: 1
    };

    expect(vectorElementStyleSettings(element)).toEqual({
      fillEnabled: true,
      fillColor: '#000000',
      strokeEnabled: true,
      strokeColor: '#ffffff',
      strokeWidth: 3,
      strokeAlignment: 'outside'
    });
    const style = patchVectorStyle(element.style, {
      fillColor: '#ff0000',
      strokeWidth: 8
    });
    expect(style.fill && !('kind' in style.fill) ? linearRgbaToCssHex(style.fill.color) : null).toBe('#ff0000');
    expect(style.stroke).toMatchObject({
      width: 8,
      alignment: 'outside',
      cap: 'square',
      join: 'bevel',
      miterLimit: 7,
      dash: [2, 4],
      dashOffset: 1
    });
  });

  it('round-trips explicit no-fill and no-stroke states without losing remembered colors', () => {
    const element = createVectorLiveShape('shape', { kind: 'ellipse', width: 20, height: 10 });
    const withoutPaint = patchVectorStyle(element.style, {
      fillEnabled: false,
      strokeEnabled: false
    });
    expect(withoutPaint.fill).toBeNull();
    expect(withoutPaint.stroke).toBeNull();
    expect(vectorElementStyleSettings({ ...element, style: withoutPaint })).toMatchObject({
      fillEnabled: false,
      strokeEnabled: false
    });
    const restored = patchVectorStyle(withoutPaint, {
      fillEnabled: true,
      fillColor: '#336699',
      strokeEnabled: true,
      strokeColor: '#ffffff'
    });
    expect(restored.fill && !('kind' in restored.fill) ? linearRgbaToCssHex(restored.fill.color) : null).toBe('#336699');
    expect(restored.stroke && !('kind' in restored.stroke.paint)
      ? linearRgbaToCssHex(restored.stroke.paint.color) : null).toBe('#ffffff');
  });

  it('creates real paint when an imported no-fill or no-stroke style is enabled', () => {
    const element = createVectorLiveShape('shape', { kind: 'ellipse', width: 20, height: 10 });
    const importedWithoutPaint = { ...element.style, fill: null, stroke: null };

    const enabled = patchVectorStyle(importedWithoutPaint, {
      fillEnabled: true,
      strokeEnabled: true
    });

    expect(enabled.fill).toEqual({ type: 'solid', color: [0, 0, 0, 1] });
    expect(enabled.stroke).toMatchObject({
      paint: { type: 'solid', color: [1, 1, 1, 1] },
      width: 3,
      cap: 'round',
      join: 'round'
    });
  });
});
