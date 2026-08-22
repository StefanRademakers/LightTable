import { createVectorLiveShape } from '@lighttable/vector-core';
import type { Rect, TextLayer, VectorLayer } from '../document/documentTypes';
import { translationMatrix } from '../geometry/affine';

const MINIMUM_PLACEHOLDER_WIDTH = 24;
const MINIMUM_PLACEHOLDER_HEIGHT = 18;

export const textPlaceholderBounds = (layer: TextLayer): Rect => {
  const source = layer.text.source;
  if (source.kind === 'flow') {
    if (source.layout.mode === 'paragraph') {
      return {
        x: source.layout.frame.x,
        y: source.layout.frame.y,
        width: Math.max(MINIMUM_PLACEHOLDER_WIDTH, source.layout.frame.width),
        height: Math.max(MINIMUM_PLACEHOLDER_HEIGHT, source.layout.frame.height)
      };
    }
    const maximumFontSize = source.styleRuns.reduce(
      (maximum, run) => Math.max(maximum, run.fontSize),
      16
    );
    const origin = source.layout.mode === 'point'
      ? source.layout.origin
      : { x: 0, y: 0 };
    return {
      x: origin.x,
      y: origin.y - maximumFontSize,
      width: Math.max(MINIMUM_PLACEHOLDER_WIDTH, source.text.length * maximumFontSize * 0.6),
      height: Math.max(MINIMUM_PLACEHOLDER_HEIGHT, maximumFontSize * 1.25)
    };
  }

  let glyphCount = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let baselineY = Number.POSITIVE_INFINITY;
  for (const run of source.runs) {
    for (const glyph of run.glyphs) {
      glyphCount += 1;
      minimumX = Math.min(minimumX, glyph.x);
      maximumX = Math.max(maximumX, glyph.x + glyph.advanceX);
      baselineY = Math.min(baselineY, glyph.y);
    }
  }
  if (glyphCount === 0) {
    return { x: 0, y: -MINIMUM_PLACEHOLDER_HEIGHT, width: MINIMUM_PLACEHOLDER_WIDTH, height: MINIMUM_PLACEHOLDER_HEIGHT };
  }
  return {
    x: minimumX,
    y: baselineY - MINIMUM_PLACEHOLDER_HEIGHT,
    width: Math.max(MINIMUM_PLACEHOLDER_WIDTH, maximumX - minimumX),
    height: MINIMUM_PLACEHOLDER_HEIGHT
  };
};

/**
 * Projects unimplemented text to a translucent GPU-vector diagnostic box.
 * It is derived render state only and never enters document persistence.
 */
export const textPlaceholderVectorLayer = (layer: TextLayer): VectorLayer => {
  const bounds = textPlaceholderBounds(layer);
  const shape = createVectorLiveShape(
    `${layer.id}:text-placeholder`,
    {
      kind: 'rectangle',
      width: bounds.width,
      height: bounds.height,
      cornerRadii: [2, 2, 2, 2],
      linkedCorners: true
    },
    'Text renderer unavailable'
  );
  shape.transform = translationMatrix(bounds.x, bounds.y);
  shape.style = {
    fill: { type: 'solid', color: [0.85, 0.16, 0.55, 0.2] },
    stroke: {
      paint: { type: 'solid', color: [1, 0.28, 0.7, 0.95] },
      width: 1,
      cap: 'butt',
      join: 'round',
      miterLimit: 4,
      dash: [5, 3],
      dashOffset: 0
    },
    opacity: 1
  };
  return {
    ...layer,
    type: 'vector',
    name: `${layer.name} (text renderer unavailable)`,
    antiAlias: true,
    elements: [shape],
    vectorClip: null
  };
};
