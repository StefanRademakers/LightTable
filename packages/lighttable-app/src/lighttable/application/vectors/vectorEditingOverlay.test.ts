import { describe, expect, it } from 'vitest';
import {
  createAnchor,
  createSubpath,
  createVectorPath,
  scaleMatrix,
  translationMatrix
} from '@lighttable/vector-core';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { createVectorEditorSelection } from '../../editor/session/editorSession';
import { buildVectorDocumentEditingOverlays } from './vectorEditingOverlay';

describe('vector document editing overlays', () => {
  it('resolves nested scene transforms without touching raster realization', () => {
    const path = createVectorPath('path', 'Path', [createSubpath('subpath', [
      createAnchor('a', { x: 1, y: 2 }, { handleOut: { x: 3, y: 2 } }),
      createAnchor('b', { x: 5, y: 2 })
    ])]);
    path.transform = translationMatrix(4, 5);
    const layer = createVectorLayer([path]);
    layer.transform = scaleMatrix(2, 3);
    const group = createGroupLayer('group');
    group.transform = translationMatrix(10, 20);
    group.children = [layer];
    const document = createImageDocument('document', 100, 100, 'asset');
    document.layers = [group];
    const selection = createVectorEditorSelection();
    selection.anchors = [{
      layerId: layer.id,
      pathId: path.id,
      subpathId: 'subpath',
      anchorId: 'a'
    }];
    selection.active = {
      layerId: layer.id,
      pathId: path.id,
      target: { kind: 'anchor', subpathId: 'subpath', anchorId: 'a' }
    };

    const overlays = buildVectorDocumentEditingOverlays(document, selection);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ layerId: layer.id, pathId: path.id });
    expect(overlays[0].anchors[0]).toMatchObject({
      point: { x: 20, y: 41 },
      selected: true,
      active: true
    });
    expect(overlays[0].handles[0]).toMatchObject({
      anchor: { x: 20, y: 41 },
      point: { x: 24, y: 41 }
    });
  });

  it('returns only selected paths and preserves topmost visual order', () => {
    const document = createImageDocument('document', 100, 100, 'asset');
    const bottom = createVectorLayer([createVectorPath('bottom')]);
    const top = createVectorLayer([createVectorPath('top')]);
    document.layers = [bottom, top];
    const selection = createVectorEditorSelection();
    selection.paths = [
      { layerId: bottom.id, pathId: 'bottom' },
      { layerId: top.id, pathId: 'top' }
    ];

    expect(buildVectorDocumentEditingOverlays(document, selection).map((item) => item.pathId))
      .toEqual(['top', 'bottom']);
  });

  it('returns no overlay for stale selection references', () => {
    const document = createImageDocument('document', 100, 100, 'asset');
    const layer = createVectorLayer([createVectorPath('path')]);
    document.layers = [layer];
    const selection = createVectorEditorSelection();
    selection.paths = [{ layerId: layer.id, pathId: 'missing-path' }];
    expect(buildVectorDocumentEditingOverlays(document, selection)).toEqual([]);
  });
});
