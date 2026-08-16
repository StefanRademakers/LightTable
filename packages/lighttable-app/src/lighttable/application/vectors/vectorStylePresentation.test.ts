import { describe, expect, it } from 'vitest';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import {
  cssHexToLinearRgba,
  linearRgbaToCssHex,
  patchVectorStyle,
  vectorElementStyleSettings,
  vectorStyleFromToolSettings
} from './vectorStylePresentation';
import { createEditorSession } from '../../editor/session/editorSession';

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
      fillPaint: { type: 'solid', color: [0, 0, 0, 1] },
      strokeEnabled: true,
      strokeColor: '#ffffff',
      strokeOpacity: 1,
      strokePaint: { type: 'solid', color: [1, 1, 1, 1] },
      strokeWidth: 3,
      strokeAlignment: 'outside',
      strokeCap: 'square',
      strokeJoin: 'bevel',
      strokeMiterLimit: 7,
      strokeStyle: 'dotted',
      opacity: 1
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
      dash: [16 / 3, 32 / 3],
      dashOffset: 8 / 3
    });
    expect(patchVectorStyle(style, { strokeStyle: 'dotted' }).stroke?.dash).toEqual([8, 16]);
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

  it('does not invent a stroke when changing fill or opacity on a no-stroke shape', () => {
    const element = createVectorLiveShape('shape', { kind: 'ellipse', width: 20, height: 10 });
    const withoutStroke = { ...element.style, stroke: null };

    expect(patchVectorStyle(withoutStroke, { fillColor: '#ff8800' }).stroke).toBeNull();
    expect(patchVectorStyle(withoutStroke, { opacity: 0.4 }).stroke).toBeNull();
  });

  it('round-trips gradient stroke paint and every authored stroke property', () => {
    const gradient = createDefaultGradientPaint('stroke-gradient', 'object-bounds');
    const element = createVectorLiveShape('shape', { kind: 'ellipse', width: 20, height: 10 });
    const styled = patchVectorStyle(element.style, {
      strokeEnabled: true,
      strokePaint: gradient,
      strokeWidth: 50,
      strokeAlignment: 'outside',
      strokeCap: 'square',
      strokeJoin: 'miter',
      strokeMiterLimit: 12,
      opacity: 0.65
    });

    expect(styled.stroke).toMatchObject({
      paint: { kind: 'gradient' }, width: 50, alignment: 'outside',
      cap: 'square', join: 'miter', miterLimit: 12
    });
    expect(styled.opacity).toBe(0.65);
    expect(vectorElementStyleSettings({ ...element, style: styled })).toMatchObject({
      strokePaint: { kind: 'gradient' }, strokeWidth: 50, strokeAlignment: 'outside',
      strokeCap: 'square', strokeJoin: 'miter', strokeMiterLimit: 12, opacity: 0.65
    });
  });

  it('authors new shapes from the same solid/gradient and stroke property model', () => {
    const settings = createEditorSession().vectorStyle;
    const fill = createDefaultGradientPaint('fill-gradient', 'object-bounds');
    const stroke = createDefaultGradientPaint('stroke-gradient', 'object-bounds');
    const style = vectorStyleFromToolSettings({
      ...settings,
      fillPaint: fill,
      strokePaint: stroke,
      strokeWidth: 200,
      strokeAlignment: 'inside',
      strokeCap: 'square',
      strokeJoin: 'miter',
      strokeMiterLimit: 16,
      opacity: 0.5
    });

    expect(style.fill).toMatchObject({ kind: 'gradient' });
    expect(style.stroke).toMatchObject({
      paint: { kind: 'gradient' }, width: 200, alignment: 'inside',
      cap: 'square', join: 'miter', miterLimit: 16
    });
    expect(style.opacity).toBe(0.5);
    expect(style.fill).not.toBe(fill);
    expect(style.stroke?.paint).not.toBe(stroke);
  });

  it('scales dashed and dotted presets with thick strokes', () => {
    const settings = createEditorSession().vectorStyle;
    expect(vectorStyleFromToolSettings({
      ...settings, strokeEnabled: true, strokeWidth: 12, strokeStyle: 'dashed'
    }).stroke?.dash).toEqual([48, 36]);
    expect(vectorStyleFromToolSettings({
      ...settings, strokeEnabled: true, strokeWidth: 12, strokeStyle: 'dotted'
    }).stroke?.dash).toEqual([12, 24]);

    const shape = createVectorLiveShape('scaled-dash', {
      kind: 'ellipse', width: 100, height: 80
    });
    const dashed = patchVectorStyle(shape.style, {
      strokeEnabled: true, strokeWidth: 8, strokeStyle: 'dashed'
    });
    expect(dashed.stroke?.dash).toEqual([32, 24]);
    expect(patchVectorStyle(dashed, { strokeWidth: 20 }).stroke?.dash).toEqual([80, 60]);
  });
});
