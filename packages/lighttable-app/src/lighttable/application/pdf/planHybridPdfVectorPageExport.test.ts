import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { describe, expect, it } from 'vitest';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { planHybridPdfVectorPageExport } from './planHybridPdfVectorPageExport';

const path = () => createVectorPath('shape', 'Shape', [createSubpath('outline', [
  createAnchor('a', { x: 0, y: 0 }),
  createAnchor('b', { x: 10, y: 0 }),
  createAnchor('c', { x: 10, y: 10 })
], true)]);

describe('planHybridPdfVectorPageExport', () => {
  it('accepts a topmost visible vector suffix above the raster underlay', () => {
    const document = createImageDocument('Vectors', 100, 100, 'pixels');
    const vector = createVectorLayer([path()]);
    document.layers.push(vector);
    const plan = planHybridPdfVectorPageExport(document, false);
    expect(plan.kind).toBe('ready');
    if (plan.kind === 'ready') expect([...plan.nativeVectorLayerIds]).toEqual([vector.id]);
  });

  it('fails closed for content above vectors, unsupported alignment and ancestor effects', () => {
    const interleaved = createImageDocument('Interleaved', 100, 100, 'pixels');
    const vector = createVectorLayer([path()]);
    interleaved.layers.unshift(vector);
    expect(planHybridPdfVectorPageExport(interleaved, false)).toMatchObject({
      kind: 'flattened-only', reasons: expect.arrayContaining(['native-vectors-not-topmost'])
    });

    const aligned = createImageDocument('Aligned', 100, 100, 'pixels');
    const outside = path();
    outside.style.stroke = {
      paint: { type: 'solid', color: [1, 0, 0, 1] }, width: 5,
      alignment: 'outside', cap: 'round', join: 'round', miterLimit: 10,
      dash: [], dashOffset: 0
    };
    aligned.layers.push(createVectorLayer([outside]));
    expect(planHybridPdfVectorPageExport(aligned, false)).toMatchObject({
      kind: 'flattened-only', reasons: expect.arrayContaining(['vector-stroke-alignment-unsupported'])
    });

    const grouped = createImageDocument('Grouped', 100, 100, 'pixels');
    const group = createGroupLayer();
    group.opacity = 0.5;
    group.children.push(createVectorLayer([path()]));
    grouped.layers.push(group);
    expect(planHybridPdfVectorPageExport(grouped, false)).toMatchObject({
      kind: 'flattened-only', reasons: expect.arrayContaining(['vector-effects-unsupported'])
    });
  });
});
