import { createDefaultFlowTextSource } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import {
  buildTextPropertyPresentation,
  solidTextPaintHex,
  textFillPatchFromHex,
  textFillEnabledPatch,
  textStrokePatch
} from './textPropertyPresentation';

describe('text property presentation', () => {
  it('keeps property-level mixed state independent', () => {
    const source = createDefaultFlowTextSource('abcd');
    const mixed = {
      ...source,
      styleRuns: [
        { ...source.styleRuns[0], start: 0, end: 2 },
        { ...source.styleRuns[0], start: 2, end: 4, tracking: 25 }
      ]
    };
    const presentation = buildTextPropertyPresentation(mixed, { anchor: 0, focus: 4 }, []);
    expect(presentation.tracking.kind).toBe('mixed');
    expect(presentation.size).toEqual({ kind: 'value', value: 16 });
    expect(presentation.fill).toEqual({ kind: 'value', value: '#000000' });
    expect(presentation.strokeColor).toEqual({ kind: 'value', value: '#000000' });
    expect(presentation.strokeWidth).toEqual({ kind: 'value', value: 0 });
    expect(presentation.alignment).toEqual({ kind: 'value', value: 'start' });
    expect(presentation.lineHeight).toEqual({ kind: 'value', value: { kind: 'normal' } });
  });

  it('projects paragraph properties independently across a selection', () => {
    const source = createDefaultFlowTextSource('one\ntwo');
    const paragraphRuns = [
      { ...source.paragraphRuns[0], start: 0, end: 4 },
      { ...source.paragraphRuns[0], start: 4, end: 7, alignment: 'end' as const }
    ];
    const presentation = buildTextPropertyPresentation(
      { ...source, paragraphRuns }, { anchor: 0, focus: 7 }, []
    );
    expect(presentation.alignment).toEqual({ kind: 'mixed' });
    expect(presentation.spaceAfter).toEqual({ kind: 'value', value: 0 });
  });

  it('reads collapsed-caret paragraph properties without mixing the full flow', () => {
    const source = createDefaultFlowTextSource('one\ntwo');
    const paragraphRuns = [
      { ...source.paragraphRuns[0], start: 0, end: 4 },
      { ...source.paragraphRuns[0], start: 4, end: 7, alignment: 'end' as const, spaceAfter: 9 }
    ];
    const presentation = buildTextPropertyPresentation(
      { ...source, paragraphRuns }, { anchor: 5, focus: 5 }, []
    );
    expect(presentation.alignment).toEqual({ kind: 'value', value: 'end' });
    expect(presentation.spaceAfter).toEqual({ kind: 'value', value: 9 });
  });

  it('parses a bounded solid fill without accepting partial color text', () => {
    expect(textFillPatchFromHex('#ff8000')).toMatchObject({
      fill: { kind: 'solid', color: { r: 1, b: 0, a: 1 } }
    });
    expect(textFillPatchFromHex('#fff')).toBeNull();
  });

  it('projects and patches semantic no-fill independently from the color', () => {
    const source = createDefaultFlowTextSource('x');
    const { fill: _fill, ...withoutFill } = source.styleRuns[0];
    const presentation = buildTextPropertyPresentation({
      ...source, styleRuns: [withoutFill]
    }, null, []);
    expect(presentation.fillEnabled).toEqual({ kind: 'value', value: false });
    expect(textFillEnabledPatch(false)).toEqual({ fill: undefined });
    expect(textFillEnabledPatch(true, '#336699')).toMatchObject({
      fill: { kind: 'solid', color: { r: 0.2, g: 0.4, b: 0.6 } }
    });
  });

  it('builds and disables a solid text stroke through the canonical style patch', () => {
    expect(textStrokePatch('#123456', 2.5)).toMatchObject({
      stroke: { paint: { kind: 'solid' }, width: 2.5, cap: 'butt', join: 'miter' }
    });
    expect(textStrokePatch('#123456', 0)).toEqual({ stroke: undefined });
    expect(textStrokePatch('#fff', 1)).toBeNull();
  });

  it('only exposes editable CSS color values for sRGB solid paint', () => {
    expect(solidTextPaintHex({
      kind: 'solid', color: { colorSpace: 'display-p3', r: 1, g: 0, b: 0, a: 1 }
    })).toBeNull();
    expect(solidTextPaintHex({
      kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [
        { offset: 0, color: { colorSpace: 'srgb', r: 0, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { colorSpace: 'srgb', r: 1, g: 1, b: 1, a: 1 } }
      ]
    })).toBeNull();
  });

  it('keeps a shared family uniform when selected faces are mixed', () => {
    const source = createDefaultFlowTextSource('ab');
    const asset = (id: string, styleName: string, weight: number) => ({
      assetId: id, faceIndex: 0, fingerprintSha256: id.repeat(64).slice(0, 64),
      source: 'document' as const, container: 'sfnt' as const, outline: 'truetype' as const,
      postScriptName: `Family-${styleName}`, embedding: {
        level: 'editable' as const, noSubsetting: false, bitmapOnly: false
      }, familyNames: ['Family'], styleName, weight, stretch: 100,
      italic: false, byteLength: 10
    });
    const regular = asset('a', 'Regular', 400);
    const bold = asset('b', 'Bold', 700);
    const requested = (font: typeof regular) => ({
      families: ['Family'], postScriptName: font.postScriptName, preferredAsset: font
    });
    const mixed = { ...source, styleRuns: [
      { ...source.styleRuns[0], start: 0, end: 1, requestedFont: requested(regular) },
      { ...source.styleRuns[0], start: 1, end: 2, requestedFont: requested(bold) }
    ] };
    const presentation = buildTextPropertyPresentation(
      mixed, { anchor: 0, focus: 2 }, [regular, bold]
    );
    expect(presentation.family).toEqual({ kind: 'value', value: 'Family' });
    expect(presentation.face.kind).toBe('mixed');
  });

  it('does not silently choose between duplicate face labels', () => {
    const source = createDefaultFlowTextSource('ab');
    const asset = (id: string) => ({
      assetId: id, faceIndex: 0, fingerprintSha256: id.repeat(64).slice(0, 64),
      source: 'document' as const, container: 'sfnt' as const, outline: 'truetype' as const,
      postScriptName: `Family-Regular-${id}`, embedding: {
        level: 'editable' as const, noSubsetting: false, bitmapOnly: false
      }, familyNames: ['Family'], styleName: 'Regular', weight: 400, stretch: 100,
      italic: false, byteLength: 10
    });
    const one = asset('a');
    const two = asset('b');
    const requested = (font: typeof one) => ({
      families: ['Family'], postScriptName: font.postScriptName, preferredAsset: font
    });
    const presentation = buildTextPropertyPresentation({ ...source, styleRuns: [
      { ...source.styleRuns[0], start: 0, end: 1, requestedFont: requested(one) },
      { ...source.styleRuns[0], start: 1, end: 2, requestedFont: requested(two) }
    ] }, { anchor: 0, focus: 2 }, [one, two]);
    expect(presentation.face).toEqual({ kind: 'mixed' });
  });
});
