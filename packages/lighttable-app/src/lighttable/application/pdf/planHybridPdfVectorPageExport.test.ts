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
    group.clipping = true;
    group.children.push(createVectorLayer([path()]));
    grouped.layers.push(group);
    expect(planHybridPdfVectorPageExport(grouped, false)).toMatchObject({
      kind: 'flattened-only', reasons: expect.arrayContaining(['vector-effects-unsupported'])
    });
  });

  it('accepts exact PDF blend modes for a single painted vector and rejects Photoshop-only modes', () => {
    const supported = createImageDocument('Multiply', 100, 100, 'pixels');
    const multiply = createVectorLayer([path()]);
    multiply.blendMode = 'multiply';
    multiply.opacity = 0.6;
    supported.layers.push(multiply);
    expect(planHybridPdfVectorPageExport(supported, false).kind).toBe('ready');

    const unsupported = createImageDocument('Linear dodge', 100, 100, 'pixels');
    const linearDodge = createVectorLayer([path()]);
    linearDodge.blendMode = 'linear-dodge';
    unsupported.layers.push(linearDodge);
    expect(planHybridPdfVectorPageExport(unsupported, false)).toMatchObject({
      kind: 'flattened-only', reasons: expect.arrayContaining(['vector-blend-mode-unsupported'])
    });
  });

  it('plans both neutral and backdrop-blended isolated groups as transparency units', () => {
    const neutral = createImageDocument('Neutral isolated group', 100, 100, 'pixels');
    const neutralGroup = createGroupLayer();
    neutralGroup.compositing = 'isolated';
    const child = createVectorLayer([path()]);
    neutralGroup.children.push(child);
    neutral.layers.push(neutralGroup);
    const ready = planHybridPdfVectorPageExport(neutral, false);
    expect(ready.kind).toBe('ready');
    if (ready.kind === 'ready') expect([...ready.nativeVectorLayerIds]).toEqual([child.id]);

    const backdrop = createImageDocument('Backdrop blend', 100, 100, 'pixels');
    const isolated = createGroupLayer();
    isolated.compositing = 'isolated';
    const multiply = createVectorLayer([path()]);
    multiply.blendMode = 'multiply';
    isolated.children.push(multiply);
    backdrop.layers.push(isolated);
    const blended = planHybridPdfVectorPageExport(backdrop, false);
    expect(blended.kind).toBe('ready');
    if (blended.kind === 'ready') {
      expect(blended.transparencyGroups[0]?.nativeVectorLayerIds).toEqual([multiply.id]);
    }
  });

  it('plans a non-neutral top-level vector group as one transparency unit', () => {
    const document = createImageDocument('Transparent group', 100, 100, 'pixels');
    const group = createGroupLayer();
    group.compositing = 'isolated';
    group.opacity = 0.45;
    group.blendMode = 'screen';
    const bottom = createVectorLayer([path()]);
    const top = createVectorLayer([path()]);
    group.children.push(bottom, top);
    document.layers.push(group);
    const plan = planHybridPdfVectorPageExport(document, false);
    expect(plan.kind).toBe('ready');
    if (plan.kind !== 'ready') return;
    expect([...plan.nativeVectorLayerIds]).toEqual([bottom.id, top.id]);
    expect(plan.transparencyGroups).toEqual([{
      groupId: group.id,
      nativeVectorLayerIds: [bottom.id, top.id],
      opacity: 0.45,
      blendMode: 'screen'
    }]);
  });
});
