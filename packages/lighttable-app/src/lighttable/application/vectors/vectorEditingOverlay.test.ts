import { describe, expect, it } from 'vitest';
import {
  createAnchor,
  createSubpath,
  createVectorLiveShape,
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
import {
  buildVectorDocumentEditingOverlays,
  buildVectorDocumentEditingSceneOverlay
} from './vectorEditingOverlay';

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

  it('does not duplicate a whole-element selection through the path overlay', () => {
    const document = createImageDocument('document', 100, 100, 'asset');
    const shape = createVectorLiveShape('shape', {
      kind: 'ellipse',
      width: 30,
      height: 20
    });
    const layer = createVectorLayer([shape]);
    document.layers = [layer];
    const selection = createVectorEditorSelection();
    selection.elements = [{ layerId: layer.id, elementId: shape.id }];

    const overlays = buildVectorDocumentEditingOverlays(document, selection);
    expect(overlays).toEqual([]);
  });

  it('keeps an explicitly selected path visible when its element is also selected', () => {
    const document = createImageDocument('document', 100, 100, 'asset');
    const shape = createVectorLiveShape('shape', {
      kind: 'ellipse',
      width: 30,
      height: 20
    });
    const layer = createVectorLayer([shape]);
    document.layers = [layer];
    const selection = createVectorEditorSelection();
    selection.elements = [{ layerId: layer.id, elementId: shape.id }];
    selection.paths = [{ layerId: layer.id, pathId: shape.id }];

    const overlays = buildVectorDocumentEditingOverlays(document, selection);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ layerId: layer.id, pathId: shape.id });
    expect(overlays[0]?.cubics.length).toBeGreaterThan(0);
    expect(overlays[0]?.anchors).toEqual([]);
    expect(overlays[0]?.handles).toEqual([]);
  });

  it('builds one stable transform frame around the whole element selection', () => {
    const document = createImageDocument('document', 100, 100, 'asset');
    const first = createVectorLiveShape('first', {
      kind: 'rectangle',
      width: 10,
      height: 20,
      cornerRadii: [0, 0, 0, 0],
      linkedCorners: true
    });
    first.transform = translationMatrix(10, 15);
    const second = createVectorLiveShape('second', {
      kind: 'ellipse',
      width: 20,
      height: 10
    });
    second.transform = translationMatrix(40, 45);
    const layer = createVectorLayer([first, second]);
    document.layers = [layer];
    const selection = createVectorEditorSelection();
    selection.elements = [
      { layerId: layer.id, elementId: second.id },
      { layerId: layer.id, elementId: first.id }
    ];

    const scene = buildVectorDocumentEditingSceneOverlay(document, selection);
    expect(scene.paths).toEqual([]);
    expect(scene.selectionFrame).toMatchObject({
      bounds: { x: 10, y: 15, width: 50, height: 40 },
      pivot: { x: 35, y: 35 }
    });
    expect(scene.selectionFrame?.handles).toHaveLength(8);
    expect(scene.selectionFrame?.resourceKey).toContain(`${layer.id}/first,${layer.id}/second`);
    expect(scene.gradientHandles).toEqual([]);
  });

  it('projects shared object-space gradient endpoints into the GPU editing overlay', () => {
    const document = createImageDocument('gradient', 200, 100, 'asset');
    const shape = createVectorLiveShape('gradient-shape', {
      kind: 'rectangle', width: 100, height: 50,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    shape.transform = translationMatrix(20, 10);
    shape.style.fill = {
      kind: 'gradient',
      asset: {
        id: 'g', name: 'G', type: 'solid', smoothness: 1,
        colorStops: [
          { id: 'a', position: 0, midpoint: 0.5, color: { r: 0, g: 0, b: 0, a: 1 } },
          { id: 'b', position: 1, midpoint: 0.5, color: { r: 1, g: 1, b: 1, a: 1 } }
        ],
        opacityStops: [
          { id: 'oa', position: 0, midpoint: 0.5, opacity: 1 },
          { id: 'ob', position: 1, midpoint: 0.5, opacity: 1 }
        ], roughness: 0, seed: 0
      },
      shape: 'linear', coordinateSpace: 'object-bounds',
      transform: { a: 0.8, b: 0, c: 0, d: 1, tx: 0.1, ty: 0.5 },
      reverse: false, dither: true, interpolation: 'perceptual'
    };
    const layer = createVectorLayer([shape]);
    document.layers = [layer];
    const selection = createVectorEditorSelection();
    selection.elements = [{ layerId: layer.id, elementId: shape.id }];

    const handles = buildVectorDocumentEditingSceneOverlay(document, selection).gradientHandles;
    expect(handles).toHaveLength(1);
    expect(handles[0]?.anchors.map(({
      anchorId, point, markerKind, markerColor, markerSizePx, active
    }) => ({
      anchorId, point, markerKind, markerColor, markerSizePx, active
    }))).toEqual([
      { anchorId: 'start', point: { x: 30, y: 35 }, markerKind: 'circle',
        markerColor: [0, 0, 0, 1], markerSizePx: 14, active: false },
      { anchorId: 'end', point: { x: 110, y: 35 }, markerKind: 'circle',
        markerColor: [1, 1, 1, 1], markerSizePx: 18, active: true }
    ]);
  });
});
