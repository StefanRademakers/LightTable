import { describe, expect, it } from 'vitest';
import { readPsd, writePsd, type Psd } from 'ag-psd';
import { assertTextLayerData } from '@lighttable/text-core';
import { importPsdText } from './psdTextAdapter';

const transparentPixels = (width: number, height: number) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4)
});

describe('Photoshop text adapter', () => {
  it('maps horizontal point text, transform and character styling into editable flow text', () => {
    const result = importPsdText({
      text: 'Hello',
      transform: [1, 0.25, -0.5, 1, 30, 40],
      orientation: 'horizontal',
      shapeType: 'point',
      pointBase: [12, 18],
      warp: { style: 'none' },
      style: {
        font: { name: 'SourceSerif4-Regular' },
        fontSize: 36,
        fillColor: { r: 255, g: 128, b: 0 },
        tracking: 25
      },
      paragraphStyle: { justification: 'center' }
    }, 'psd-layer-1');

    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow') return;
    expect(() => assertTextLayerData(result.text)).not.toThrow();
    expect(result.transform).toEqual({ a: 1, b: 0.25, c: -0.5, d: 1, tx: 30, ty: 40 });
    expect(result.text.source).toMatchObject({
      kind: 'flow',
      text: 'Hello',
      layout: { mode: 'point', origin: { x: 12, y: 18 } },
      styleRuns: [{
        requestedFont: { families: ['Source Serif 4'] },
        fontSize: 36,
        fontStyle: 'normal',
        tracking: 25,
        fill: { color: { r: 1, g: 128 / 255, b: 0 } }
      }],
      paragraphRuns: [{ alignment: 'center' }]
    });
    expect(result.text.interchange).toMatchObject({
      format: 'psd', sourceObjectId: 'psd-layer-1'
    });
  });

  it('preserves a Photoshop 90-degree point-text affine without raster fallback', () => {
    const result = importPsdText({
      text: '90 degrees rotation',
      transform: [0, -1.5, 1.5, 0, 1851.5, 732.25]
    });

    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow') return;
    expect(result.transform).toEqual({
      a: 0, b: -1.5, c: 1.5, d: 0, tx: 1851.5, ty: 732.25
    });
    expect(result.text.source.kind).toBe('flow');
  });

  it('maps a valid Photoshop box to an editable paragraph frame', () => {
    const result = importPsdText({
      text: 'Paragraph', shapeType: 'box', boxBounds: [10, 20, 210, 120],
      style: { fontSize: 24 }, paragraphStyle: { autoHyphenate: false }
    });
    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow' || result.text.source.kind !== 'flow') return;
    expect(result.text.source.layout).toEqual({
      mode: 'paragraph',
      frame: { x: 10, y: 20, width: 200, height: 100 },
      overflow: 'visible',
      writingMode: 'horizontal-tb'
    });
    expect(result.text.source.paragraphRuns[0]?.hyphenation).toBe('off');
  });

  it('normalizes ag-psd unit character scaling to canonical 100 percent', () => {
    const result = importPsdText({
      text: 'Photoshop text',
      style: { horizontalScale: 1, verticalScale: 1, fontSize: 50, dLigatures: false }
    });
    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow' || result.text.source.kind !== 'flow') return;
    expect(result.text.source.styleRuns[0]).toMatchObject({
      horizontalScale: 100,
      verticalScale: 100,
      openTypeFeatures: {}
    });
  });

  it.each([
    ['Inter-Medium', 500],
    ['Inter-SemiBold', 600],
    ['SourceSerif4-Bold', 700]
  ])('derives the exact selection weight from %s', (postScriptName, weight) => {
    const result = importPsdText({
      text: 'Weighted', style: { font: { name: postScriptName }, fontSize: 50 }
    });
    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow' || result.text.source.kind !== 'flow') return;
    expect(result.text.source.styleRuns[0]?.fontWeight).toBe(weight);
  });

  it('imports Photoshop fillFlag=false as semantic no-fill instead of transparent black', () => {
    const result = importPsdText({ text: 'Outline', style: {
      fillFlag: false,
      strokeFlag: true,
      outlineWidth: 2,
      strokeColor: { r: 255, g: 0, b: 0 }
    } });
    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow' || result.text.source.kind !== 'flow') return;
    expect(result.text.source.styleRuns[0]?.fill).toBeUndefined();
    expect(result.text.source.styleRuns[0]?.stroke).toMatchObject({ width: 2 });
  });

  it('maps recovered Photoshop path text to native cubic geometry and flow binding', () => {
    const result = importPsdText({
      text: 'On a curve',
      transform: [1, 0, 0, 1, 10, 20],
      textPath: {
        bezierCurve: { controlPoints: [10, 20, 20, 20, 30, 30, 40, 40] },
        data: {
          frameMatrix: [1, 0, 0, 1, -10, -20],
          textRange: [0, 1],
          pathData: { reversed: false }
        }
      }
    }, 'text-layer', {
      layerId: 'path-layer', elementId: 'path-element', subpathId: 'path-subpath'
    });

    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow' || result.text.source.kind !== 'flow') return;
    expect(result.text.source.layout).toMatchObject({
      mode: 'path', pathLayerId: 'path-layer', pathElementId: 'path-element',
      pathSubpathId: 'path-subpath', startOffset: 0, direction: 'forward',
      side: 'left', upright: false
    });
    expect(result.text.source.layout.mode === 'path'
      ? result.text.source.layout.endOffset : 0).toBeGreaterThan(30);
    expect(result.path?.subpaths[0]?.anchors).toMatchObject([
      { position: { x: 0, y: 0 }, handleOut: { x: 10, y: 0 } },
      { position: { x: 30, y: 20 }, handleIn: { x: 20, y: 10 } }
    ]);
    expect(result.path?.style).toEqual({ fill: null, stroke: null, opacity: 1 });
  });

  it('maps Photoshop cubic parameters to editable path arc-length handles', () => {
    const result = importPsdText({
      text: 'Partial path',
      textPath: {
        bezierCurve: { controlPoints: [0, 0, 10, 0, 20, 0, 30, 0] },
        data: {
          frameMatrix: [1, 0, 0, 1, 0, 0],
          textRange: [0.5, 1],
          pathData: { reversed: false }
        }
      }
    }, 'text-layer', {
      layerId: 'path-layer', elementId: 'path-element', subpathId: 'path-subpath'
    });

    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow' || result.text.source.kind !== 'flow') return;
    expect(result.text.source.layout).toMatchObject({
      mode: 'path', startOffset: 15, endOffset: 30, upright: false
    });
  });

  it('imports a text descriptor after an actual PSD binary write/read round trip', () => {
    const psd: Psd = {
      width: 64,
      height: 64,
      imageData: transparentPixels(64, 64),
      children: [{
        name: 'Editable text',
        left: 0,
        top: 0,
        right: 64,
        bottom: 64,
        imageData: transparentPixels(64, 64),
        text: {
          text: 'PSD fixture',
          transform: [1, 0.125, -0.25, 1, 7, 11],
          orientation: 'horizontal',
          shapeType: 'point',
          pointBase: [3, 5],
          style: {
            font: { name: 'Inter' },
            fontSize: 27,
            fillColor: { r: 12, g: 34, b: 56 }
          },
          paragraphStyle: { justification: 'right' }
        }
      }]
    };

    const bytes = writePsd(psd);
    const parsed = readPsd(bytes, {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    });
    const descriptor = parsed.children?.[0]?.text;

    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(descriptor).toMatchObject({
      text: 'PSD fixture',
      transform: [1, 0.125, -0.25, 1, 7, 11],
      shapeType: 'point',
      pointBase: [3, 5]
    });

    const result = importPsdText(descriptor, 'serialized-psd-text');
    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow') return;
    expect(() => assertTextLayerData(result.text)).not.toThrow();
    expect(result.transform).toEqual({ a: 1, b: 0.125, c: -0.25, d: 1, tx: 7, ty: 11 });
    expect(result.text.source).toMatchObject({
      kind: 'flow',
      text: 'PSD fixture',
      layout: { mode: 'point', origin: { x: 3, y: 5 } },
      styleRuns: [{ requestedFont: { families: ['Inter'] }, fontSize: 27, kerning: 'metrics' }],
      paragraphRuns: [{ alignment: 'end' }]
    });
  });

  it.each([
    [{ text: 'Warp', warp: { style: 'arc' } }, 'Warped'],
    [{ text: 'Path', textPath: { data: {} } }, 'path'],
    [{ text: 'Vertical', orientation: 'vertical' }, 'Vertical'],
    [{ text: 'Bad transform', transform: [1, 0, 0] }, 'transform'],
    [{ text: 'Bad runs', styleRuns: [{ length: 2, style: {} }] }, 'run lengths'],
    [{ text: 'Faux', style: { fauxBold: true } }, 'faux'],
    [{ text: 'Baseline', style: { baselineShift: 2 } }, 'baseline'],
    [{ text: 'Scaled', style: { horizontalScale: 90 } }, 'scaling'],
    [{ text: 'Kerning', style: { autoKerning: false } }, 'kerning'],
    [{ text: 'Ligature', style: { ligatures: false } }, 'ligature'],
    [{ text: 'Underline', style: { underline: true } }, 'decorations'],
    [{
      text: 'Hyphenation', shapeType: 'box', boxBounds: [0, 0, 100, 100],
      paragraphStyle: { autoHyphenate: true }
    }, 'hyphenation']
  ])('preserves unsupported descriptors without claiming editability', (descriptor, reason) => {
    const result = importPsdText(descriptor);
    expect(result).toMatchObject({ kind: 'preserved' });
    expect(result.reasons.join(' ')).toContain(reason);
  });
});
