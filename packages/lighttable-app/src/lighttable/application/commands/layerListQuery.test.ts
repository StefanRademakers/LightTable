import { describe, expect, it } from 'vitest';
import { createGroupLayer as createGroupNode, createImageDocument,
  type LayerNode } from '../../editor/document/documentTypes';
import { createRasterLayer, createVectorLayer } from '../../editor/document/documentCommands';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { projectLayerListPage } from './layerListQuery';

const documentWithLayers = () => {
  let document = createImageDocument('Paged', 100, 80, 'source');
  for (let index = 0; index < 5; index += 1) document = createRasterLayer(document, `Layer ${index}`);
  return document;
};

describe('projectLayerListPage', () => {
  it('returns compact revision-bound pages and a continuation cursor', () => {
    const document = documentWithLayers();
    const first = projectLayerListPage('document-1', document, 7, { limit: 2 });
    expect(first).toMatchObject({ status: 'completed', canonicalRevision: 7,
      offset: 0, limit: 2, truncated: true, layers: [{}, {}] });
    if (first.status !== 'completed') throw new Error('Expected first page.');
    const second = projectLayerListPage('document-1', document, 7,
      { limit: 2, cursor: first.nextCursor });
    expect(second).toMatchObject({ status: 'completed', offset: 2, layers: [{}, {}] });
  });

  it('rejects stale revisions and cross-document cursors', () => {
    const document = documentWithLayers();
    const first = projectLayerListPage('document-1', document, 4, { limit: 1 });
    if (first.status !== 'completed') throw new Error('Expected first page.');
    expect(projectLayerListPage('document-1', document, 5,
      { cursor: first.nextCursor })).toMatchObject({ status: 'rejected',
      code: 'stale-document-revision', currentRevision: 5 });
    expect(projectLayerListPage('document-2', document, 4,
      { cursor: first.nextCursor })).toMatchObject({ status: 'rejected',
      code: 'invalid-request' });
  });

  it('does not inline vector elements into list pages', () => {
    let document = createImageDocument('Vector', 100, 80, 'source');
    const shape = createVectorLiveShape('shape-1', {
      kind: 'rectangle', width: 20, height: 10,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    document = createVectorLayer(document, [shape], 'Shapes');
    const vector = document.layers.find(({ type }) => type === 'vector');
    if (!vector || vector.type !== 'vector') throw new Error('Missing vector layer.');
    const page = projectLayerListPage('document-1', document, 1, {});
    if (page.status !== 'completed') throw new Error('Expected page.');
    const item = page.layers.find(({ id }) => id === vector.id);
    expect(item?.vectorContent).toEqual({ elementCount: 1, truncated: true, elements: [] });
    expect(item?.bounds).toEqual({
      coordinateSpace: 'document',
      document: { x: 0, y: 0, width: 20, height: 10 },
      visual: { x: 0, y: 0, width: 20, height: 10 },
      source: 'vector-paint'
    });
  });

  it('keeps memory and call-stack bounded for wide and deeply nested layer trees', () => {
    const base = createRasterLayer(createImageDocument('Large', 100, 80, 'source'));
    const leaf = base.layers[0]!;
    const wide = { ...base, layers: Array.from({ length: 5_000 }, (_, index) => ({
      ...leaf, id: `wide-${index}` as typeof leaf.id, name: `Wide ${index}`
    })) };
    const widePage = projectLayerListPage('wide-document', wide, 9, { limit: 32 });
    expect(widePage).toMatchObject({ status: 'completed', total: 5_000,
      layers: expect.any(Array), truncated: true });
    if (widePage.status !== 'completed') throw new Error('Expected wide page.');
    expect(widePage.layers).toHaveLength(32);

    let nested: LayerNode = leaf;
    for (let depth = 0; depth < 2_000; depth += 1) {
      nested = { ...createGroupNode(`Depth ${depth}`), children: [nested] };
    }
    const deep = { ...base, layers: [nested] };
    const deepPage = projectLayerListPage('deep-document', deep, 10, { limit: 8 });
    expect(deepPage).toMatchObject({ status: 'completed', total: 2_001,
      truncated: true });
    if (deepPage.status !== 'completed') throw new Error('Expected deep page.');
    expect(deepPage.layers.map(({ depth }) => depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
