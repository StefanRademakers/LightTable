import { describe, expect, it } from 'vitest';
import { assertTextLayerData } from '@lighttable/text-core';
import { importPsdText } from './psdTextAdapter';

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
        tracking: 25,
        fauxItalic: true
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
        requestedFont: { families: ['SourceSerif4-Regular'] },
        fontSize: 36,
        fontStyle: 'italic',
        tracking: 25,
        fill: { color: { r: 1, g: 128 / 255, b: 0 } }
      }],
      paragraphRuns: [{ alignment: 'center' }]
    });
    expect(result.text.interchange).toMatchObject({
      format: 'psd', sourceObjectId: 'psd-layer-1'
    });
  });

  it('maps a valid Photoshop box to an editable paragraph frame', () => {
    const result = importPsdText({
      text: 'Paragraph', shapeType: 'box', boxBounds: [10, 20, 210, 120],
      style: { fontSize: 24 }, paragraphStyle: { autoHyphenate: true }
    });
    expect(result.kind).toBe('editable-flow');
    if (result.kind !== 'editable-flow' || result.text.source.kind !== 'flow') return;
    expect(result.text.source.layout).toEqual({
      mode: 'paragraph',
      frame: { x: 10, y: 20, width: 200, height: 100 },
      overflow: 'visible',
      writingMode: 'horizontal-tb'
    });
    expect(result.text.source.paragraphRuns[0]?.hyphenation).toBe('auto');
  });

  it.each([
    [{ text: 'Warp', warp: { style: 'arc' } }, 'Warped'],
    [{ text: 'Path', textPath: { data: {} } }, 'path'],
    [{ text: 'Vertical', orientation: 'vertical' }, 'Vertical'],
    [{ text: 'Bad transform', transform: [1, 0, 0] }, 'transform'],
    [{ text: 'Bad runs', styleRuns: [{ length: 2, style: {} }] }, 'run lengths']
  ])('preserves unsupported descriptors without claiming editability', (descriptor, reason) => {
    const result = importPsdText(descriptor);
    expect(result).toMatchObject({ kind: 'preserved' });
    expect(result.reasons.join(' ')).toContain(reason);
  });
});
