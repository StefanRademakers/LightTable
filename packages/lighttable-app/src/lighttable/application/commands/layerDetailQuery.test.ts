import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer, createVectorLayer } from '../../editor/document/documentCommands';
import { createVectorLiveShape } from '@lighttable/vector-core';
import { projectLayerDetailQuery } from './layerDetailQuery';

describe('projectLayerDetailQuery', () => {
  it('resolves the active raster layer without exposing runtime identities', () => {
    const document = createRasterLayer(createImageDocument('Inspect', 100, 80, 'source'));
    const result = projectLayerDetailQuery('document-1', document, 4, {
      expectedDocumentRevision: 4
    });
    expect(result).toMatchObject({ status: 'completed', resolvedFrom: 'active-layer',
      content: { kind: 'raster', source: { kind: 'runtime-raster' } },
      layer: { bounds: { coordinateSpace: 'document',
        document: { x: 0, y: 0, width: 100, height: 80 }, source: 'raster-source' } },
      availableQueries: expect.arrayContaining(['layer.preview:pixels', 'layer.palette', 'warp.query']) });
    expect(JSON.stringify(result)).not.toContain('runtimeId');
  });

  it('summarizes vector complexity while keeping geometry behind vector.query', () => {
    let document = createImageDocument('Vector', 100, 80, 'source');
    document = createVectorLayer(document, [createVectorLiveShape('shape-1', {
      kind: 'rectangle', width: 20, height: 10,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    })], 'Shape');
    const result = projectLayerDetailQuery('document-1', document, 2, {});
    expect(result).toMatchObject({ status: 'completed', content: { kind: 'vector',
      elementCount: 1, liveShapeCount: 1, pathCount: 0, anchorCount: 0 },
      layer: { vectorContent: { elementCount: 1, elements: [] } },
      availableQueries: expect.arrayContaining(['vector.query']) });
  });

  it('fails closed for stale revisions and unknown explicit IDs', () => {
    const document = createRasterLayer(createImageDocument('Inspect', 100, 80, 'source'));
    expect(projectLayerDetailQuery('document-1', document, 5,
      { expectedDocumentRevision: 4 })).toMatchObject({ status: 'rejected',
      code: 'stale-document-revision', currentRevision: 5 });
    expect(projectLayerDetailQuery('document-1', document, 5,
      { layerId: 'missing' })).toMatchObject({ status: 'rejected', code: 'layer-not-found' });
  });
});
