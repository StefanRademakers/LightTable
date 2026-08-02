import { createDefaultTextLayerData, createPositionedTextFixture } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { createTextLayerNode } from '../document/documentTypes';
import { textPlaceholderBounds, textPlaceholderVectorLayer } from './textPlaceholderPresentation';

describe('text diagnostic GPU presentation', () => {
  it('derives a bounded point-text vector without changing canonical text', () => {
    const layer = createTextLayerNode(createDefaultTextLayerData(), 'Headline');
    const canonicalSnapshot = structuredClone(layer);
    const bounds = textPlaceholderBounds(layer);
    const projection = textPlaceholderVectorLayer(layer);

    expect(bounds).toEqual({ x: 0, y: -16, width: 38.4, height: 20 });
    expect(projection).toMatchObject({
      id: layer.id,
      type: 'vector',
      name: 'Headline (text renderer unavailable)',
      antiAlias: true
    });
    expect(projection.elements).toHaveLength(1);
    expect(layer).toEqual(canonicalSnapshot);
  });

  it('bounds positioned glyphs without expanding their arrays onto the call stack', () => {
    const layer = createTextLayerNode(createPositionedTextFixture(), 'Imported text');

    expect(textPlaceholderBounds(layer)).toEqual({ x: 0, y: -18, width: 24, height: 18 });
  });
});
