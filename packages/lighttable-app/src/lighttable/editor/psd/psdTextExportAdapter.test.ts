import { describe, expect, it } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { exportTextLayerToPsd } from './psdTextExportAdapter';

describe('PSD text export coordinates', () => {
  it('places new point text through the TySh transform Photoshop actually evaluates', () => {
    const text = createDefaultTextLayerData();
    if (text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
    const point = { ...text, source: { ...text.source,
      layout: { mode: 'point' as const, origin: { x: 130, y: 260 }, writingMode: 'horizontal-tb' as const } } };
    expect(exportTextLayerToPsd(point, { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 20 }))
      .toMatchObject({ transform: [2, 0, 0, 2, 270, 540], pointBase: [0, 0] });
  });

  it('normalizes paragraph bounds under the translated TySh transform', () => {
    const text = createDefaultTextLayerData();
    if (text.source.kind !== 'flow') throw new Error('Expected flow text fixture.');
    const paragraph = { ...text, source: { ...text.source,
      layout: { mode: 'paragraph' as const, frame: { x: 40, y: 80, width: 300, height: 180 },
        writingMode: 'horizontal-tb' as const, overflow: 'clip' as const } } };
    expect(exportTextLayerToPsd(paragraph, { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 7 }))
      .toMatchObject({ transform: [1, 0, 0, 1, 45, 87], boxBounds: [0, 0, 300, 180] });
  });
});
