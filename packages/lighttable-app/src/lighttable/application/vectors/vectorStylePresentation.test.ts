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
      strokeWidth: 3
    });
    const style = patchVectorStyle(element.style, {
      fillColor: '#ff0000',
      strokeWidth: 8
    });
    expect(linearRgbaToCssHex(style.fill?.color ?? [])).toBe('#ff0000');
    expect(style.stroke).toMatchObject({
      width: 8,
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
    expect(linearRgbaToCssHex(restored.fill?.color ?? [])).toBe('#336699');
    expect(linearRgbaToCssHex(restored.stroke?.paint.color ?? [])).toBe('#ffffff');
  });
});
