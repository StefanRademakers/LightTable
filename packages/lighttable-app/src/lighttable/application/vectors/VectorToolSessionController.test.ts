import { describe, expect, it, vi } from 'vitest';
import type { VectorIdSource, VectorPath } from '@lighttable/vector-core';
import {
  createAnchor,
  createSubpath,
  createVectorLiveShape,
  createVectorPath
} from '@lighttable/vector-core';
import { createImageDocument, createVectorLayer } from '../../editor/document/documentTypes';
import { setActiveLayer } from '../../editor/document/documentCommands';
import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createVectorEditorSelection,
  type VectorEditorSelection
} from '../../editor/session/editorSession';
import { VectorToolSessionController } from './VectorToolSessionController';
import type { VectorElementCreationTransaction } from './VectorDocumentController';

const ids = (): VectorIdSource => {
  let value = 0;
  return { next: (kind) => `${kind}-${++value}` };
};

const layerPaths = (layer: ReturnType<typeof findDocumentLayer>): VectorPath[] => (
  layer?.type === 'vector'
    ? layer.elements.filter((element): element is VectorPath => element.type === 'path')
    : []
);

const setup = (rasterizeShape?: (transaction: VectorElementCreationTransaction) => boolean) => {
  let document = createImageDocument('Vector tools', 200, 100, 'asset');
  let selection: VectorEditorSelection = createVectorEditorSelection();
  const history: Array<{ before: typeof document; after: typeof document }> = [];
  const controller = new VectorToolSessionController({
    getDocument: () => document,
    applyDocumentSnapshot: (next) => { document = next; },
    pushDocumentHistory: (before, after) => history.push({ before, after }),
    getSelection: () => selection,
    setSelection: (next) => { selection = next; }
  }, { ids: ids(), rasterizeShape });
  return {
    controller,
    history,
    get document() { return document; },
    set document(next) { document = next; },
    get selection() { return selection; }
  };
};

describe('VectorToolSessionController', () => {
  it('selects an active shape layer when element selection is activated', () => {
    const state = setup();
    const shape = createVectorLiveShape('shape-1', {
      kind: 'rectangle',
      width: 40,
      height: 20,
      cornerRadii: [0, 0, 0, 0],
      linkedCorners: true
    }, 'Imported shape');
    const layer = createVectorLayer([shape], 'PSD Shape');
    state.document = {
      ...state.document,
      layers: [layer],
      activeLayerId: layer.id
    };

    expect(state.controller.activate('element-selection')).toBe(true);
    expect(state.selection.elements).toEqual([{
      layerId: layer.id,
      elementId: shape.id
    }]);
  });

  it('projects a Layers-panel vector choice into element style selection', () => {
    const state = setup();
    const path = createVectorPath('psd-path', 'Imported PSD path', [createSubpath('shape', [
      createAnchor('a', { x: 0, y: 0 }),
      createAnchor('b', { x: 20, y: 0 }),
      createAnchor('c', { x: 20, y: 20 })
    ], true)]);
    const layer = createVectorLayer([path], 'Imported PSD Shape');
    state.document = { ...state.document, layers: [layer], activeLayerId: null };

    expect(state.controller.prepareActiveLayerChange(layer.id)).toBe(true);
    expect(state.selection.elements).toEqual([{ layerId: layer.id, elementId: path.id }]);
  });

  it('keeps a multi-click pen path provisional and commits it as one command', () => {
    const state = setup();
    state.controller.activate('pen');
    expect(state.controller.pointerDown(1, { x: 10, y: 10 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerUp(1, { x: 10, y: 10 })).toBe(true);
    expect(state.controller.pointerDown(2, { x: 80, y: 30 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerUp(2, { x: 80, y: 30 })).toBe(true);
    expect(state.history).toHaveLength(0);

    expect(state.controller.finishPenPath()).toBe(true);
    expect(state.history).toHaveLength(1);
    const layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    expect(layerPaths(layer)[0]?.subpaths[0]?.anchors).toHaveLength(2);
  });

  it('finishes an active open Pen path when Ctrl-clicking away from vector geometry', () => {
    const state = setup();
    state.controller.activate('pen');
    expect(state.controller.pointerDown(1, { x: 20, y: 20 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerUp(1, { x: 20, y: 20 })).toBe(true);
    expect(state.controller.pointerDown(2, { x: 60, y: 20 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerUp(2, { x: 60, y: 20 })).toBe(true);

    expect(state.controller.pointerDown(3, { x: 150, y: 80 }, {
      hitRadius: 3,
      temporaryDirect: true
    })).toBe(true);
    expect(state.controller.ownsPointer(3)).toBe(false);
    expect(state.history).toHaveLength(1);
    const activeLayerId = state.document.activeLayerId;
    if (!activeLayerId) throw new Error('Expected an active Pen layer.');
    expect(layerPaths(findDocumentLayer(
      state.document,
      activeLayerId
    ))[0]?.subpaths[0]?.anchors).toHaveLength(2);
  });

  it('finishes an open Pen path before an external active-layer change', () => {
    const state = setup();
    state.controller.activate('pen');
    for (const [pointerId, point] of [
      { x: 10, y: 10 },
      { x: 80, y: 30 }
    ].entries()) {
      state.controller.pointerDown(pointerId, point, { hitRadius: 3 });
      state.controller.pointerUp(pointerId, point);
    }
    const firstLayerId = state.document.activeLayerId!;

    expect(state.controller.prepareActiveLayerChange(null)).toBe(true);
    state.document = setActiveLayer(state.document, null);
    expect(state.history).toHaveLength(1);

    state.controller.pointerDown(8, { x: 20, y: 70 }, { hitRadius: 3 });
    state.controller.pointerUp(8, { x: 20, y: 70 });
    state.controller.pointerDown(9, { x: 100, y: 70 }, { hitRadius: 3 });
    state.controller.pointerUp(9, { x: 100, y: 70 });
    state.controller.finishPenPath();

    expect(state.document.activeLayerId).not.toBe(firstLayerId);
    expect(layerPaths(findDocumentLayer(state.document, firstLayerId))).toHaveLength(1);
    expect(state.history).toHaveLength(2);
  });

  it('closes a pen path through the first-anchor hit without capturing the pointer', () => {
    const state = setup();
    state.controller.activate('pen');
    for (const [index, point] of [
      { x: 10, y: 10 },
      { x: 80, y: 10 },
      { x: 40, y: 70 }
    ].entries()) {
      state.controller.pointerDown(index, point, { hitRadius: 3 });
      state.controller.pointerUp(index, point);
    }

    expect(state.controller.pointerDown(9, { x: 11, y: 11 }, {
      hitRadius: 3,
      closeTolerance: 3
    })).toBe(true);
    expect(state.controller.ownsPointer(9)).toBe(false);
    expect(state.history).toHaveLength(1);
    const layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    expect(layerPaths(layer)[0]?.subpaths[0]?.closed ?? false).toBe(true);
  });

  it('rejects a competing pointer and releases ownership at pointer-up', () => {
    const state = setup();
    state.controller.activate('pen');
    expect(state.controller.pointerDown(4, { x: 10, y: 10 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.ownsPointer(4)).toBe(true);
    expect(state.controller.pointerDown(5, { x: 20, y: 20 }, { hitRadius: 3 })).toBe(false);
    expect(state.controller.pointerMove(5, { x: 30, y: 30 })).toBe(false);
    state.controller.pointerUp(4, { x: 10, y: 10 });
    expect(state.controller.ownsPointer(4)).toBe(false);
  });

  it('creates a live shape through the document-owned pointer session', () => {
    const state = setup();
    expect(state.controller.setLiveShapePreset({
      kind: 'star',
      points: 6,
      innerRatio: 0.35
    })).toBe(true);
    expect(state.controller.activate('live-shape')).toBe(true);

    expect(state.controller.pointerDown(12, { x: 40, y: 30 }, { hitRadius: 2 })).toBe(true);
    expect(state.controller.pointerMove(12, { x: 70, y: 70 })).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.controller.pointerUp(12, { x: 70, y: 70 })).toBe(true);
    expect(state.history).toHaveLength(1);

    const layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    expect(layer?.type).toBe('vector');
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(layer.elements[0]).toMatchObject({
      type: 'live-shape',
      geometry: {
        kind: 'star',
        points: 6,
        outerRadius: 50,
        innerRadius: 17.5
      },
      transform: { tx: 40, ty: 30 }
    });
  });

  it('hands Pixels-mode live shapes to one deferred raster transaction', () => {
    const rasterizeShape = vi.fn((_transaction: VectorElementCreationTransaction) => true);
    const state = setup(rasterizeShape);
    state.controller.activate('live-shape');

    expect(state.controller.pointerDown(
      12, { x: 10, y: 10 }, { hitRadius: 2, rasterize: true }
    )).toBe(true);
    state.controller.pointerMove(12, { x: 70, y: 50 }, { rasterize: true });
    expect(state.controller.pointerUp(
      12, { x: 70, y: 50 }, 1, { rasterize: true }
    )).toBe(true);

    expect(rasterizeShape).toHaveBeenCalledOnce();
    expect(rasterizeShape.mock.calls[0]?.[0]).toMatchObject({
      beforeDocument: { name: 'Vector tools' },
      previewDocument: { activeLayerId: expect.any(String) },
      elementId: 'live-shape-1'
    });
    expect(state.history).toHaveLength(0);
  });

  it('selects and translates a live shape without converting its geometry', () => {
    const state = setup();
    const shape = createVectorLiveShape('shape', {
      kind: 'rectangle',
      width: 40,
      height: 20,
      cornerRadii: [4, 4, 4, 4],
      linkedCorners: true
    });
    shape.transform = { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 20 };
    const layer = createVectorLayer([shape]);
    layer.transform = { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 5 };
    state.document.layers = [layer];
    state.controller.activate('element-selection');

    expect(state.controller.pointerDown(20, { x: 90, y: 65 }, { hitRadius: 3 })).toBe(true);
    expect(state.selection.elements).toEqual([{ layerId: layer.id, elementId: shape.id }]);
    expect(state.controller.pointerMove(20, { x: 110, y: 75 })).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.controller.pointerUp(20, { x: 110, y: 75 })).toBe(true);
    expect(state.history).toHaveLength(1);

    const updated = findDocumentLayer(state.document, layer.id);
    if (updated?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(updated.elements[0]).toMatchObject({
      id: shape.id,
      type: 'live-shape',
      geometry: shape.geometry,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 30, ty: 25 },
      transformRevision: 1
    });
  });

  it('drags a selected gradient endpoint as one non-React document transaction', () => {
    const state = setup();
    const shape = createVectorLiveShape('gradient-shape', {
      kind: 'rectangle', width: 100, height: 50,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    shape.transform = { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 10 };
    shape.style.fill = createDefaultGradientPaint('drag-gradient');
    const layer = createVectorLayer([shape]);
    state.document.layers = [layer];
    state.document.activeLayerId = layer.id;
    state.controller.activate('element-selection');

    expect(state.controller.pointerDown(21, { x: 120, y: 35 }, { hitRadius: 5 })).toBe(true);
    expect(state.controller.pointerMove(21, { x: 170, y: 60 })).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.controller.pointerUp(21, { x: 170, y: 60 })).toBe(true);
    expect(state.history).toHaveLength(1);

    const updated = findDocumentLayer(state.document, layer.id);
    if (updated?.type !== 'vector') throw new Error('Expected vector layer.');
    const fill = updated.elements[0]?.style.fill;
    expect(fill && 'kind' in fill ? fill.transform : null).toMatchObject({
      a: 1.5, b: 0.5, tx: 0, ty: 0.5
    });
  });

  it('scales a live shape through its document-space frame as one transaction', () => {
    const state = setup();
    const shape = createVectorLiveShape('shape', {
      kind: 'rectangle',
      width: 40,
      height: 20,
      cornerRadii: [4, 4, 4, 4],
      linkedCorners: true
    });
    shape.transform = { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 20 };
    const layer = createVectorLayer([shape]);
    layer.transform = { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 5 };
    state.document.layers = [layer];
    state.controller.activate('element-selection');

    // Select through the artwork first. The resulting document-space frame is
    // x=50..130, y=45..85 despite both the element and layer transforms.
    state.controller.pointerDown(1, { x: 90, y: 65 }, { hitRadius: 3 });
    state.controller.pointerUp(1, { x: 90, y: 65 });
    expect(state.selection.elements).toEqual([{ layerId: layer.id, elementId: shape.id }]);

    expect(state.controller.pointerDown(2, { x: 130, y: 85 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerMove(2, { x: 170, y: 105 })).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.controller.pointerUp(2, { x: 170, y: 105 })).toBe(true);
    expect(state.history).toHaveLength(1);

    const updated = findDocumentLayer(state.document, layer.id);
    if (updated?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(updated.elements[0]).toMatchObject({
      id: shape.id,
      type: 'live-shape',
      geometry: shape.geometry,
      transform: { a: 1.5, b: 0, c: 0, d: 1.5, tx: 20, ty: 20 },
      transformRevision: 1
    });
  });

  it('moves an additive element selection as one transaction', () => {
    const state = setup();
    const first = createVectorLiveShape('first', {
      kind: 'ellipse',
      width: 20,
      height: 20
    });
    first.transform.tx = 20;
    first.transform.ty = 20;
    const second = createVectorLiveShape('second', {
      kind: 'ellipse',
      width: 20,
      height: 20
    });
    second.transform.tx = 70;
    second.transform.ty = 20;
    const layer = createVectorLayer([first, second]);
    state.document.layers = [layer];
    state.controller.activate('element-selection');

    state.controller.pointerDown(1, { x: 30, y: 30 }, { hitRadius: 2 });
    state.controller.pointerUp(1, { x: 30, y: 30 });
    state.controller.pointerDown(2, { x: 80, y: 30 }, { hitRadius: 2, additive: true });
    state.controller.pointerUp(2, { x: 80, y: 30 });
    expect(state.history).toHaveLength(0);
    expect(state.selection.elements.map(({ elementId }) => elementId)).toEqual(['first', 'second']);

    state.controller.pointerDown(3, { x: 30, y: 30 }, { hitRadius: 2 });
    state.controller.pointerMove(3, { x: 35, y: 36 });
    state.controller.pointerUp(3, { x: 35, y: 36 });
    expect(state.history).toHaveLength(1);
    const updated = findDocumentLayer(state.document, layer.id);
    if (updated?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(updated.elements.map(({ transform }) => ({ tx: transform.tx, ty: transform.ty })))
      .toEqual([{ tx: 25, ty: 26 }, { tx: 75, ty: 26 }]);
  });

  it('updates the style of every selected element as one history command', () => {
    const state = setup();
    const first = createVectorLiveShape('first', {
      kind: 'rectangle',
      width: 20,
      height: 20,
      cornerRadii: [0, 0, 0, 0],
      linkedCorners: true
    });
    const second = createVectorLiveShape('second', {
      kind: 'ellipse',
      width: 20,
      height: 20
    });
    for (const element of [first, second]) {
      element.style.stroke = {
        paint: { type: 'solid', color: [1, 1, 1, 1] },
        width: 3,
        cap: 'round',
        join: 'round',
        miterLimit: 4,
        dash: [],
        dashOffset: 0
      };
    }
    const layer = createVectorLayer([first, second]);
    state.document.layers = [layer];
    state.controller.activate('element-selection');
    // Hit-testing overlapping geometry is intentionally avoided here: the
    // command accepts the same document-scoped selection model as the tool.
    state.selection.elements = [
      { layerId: layer.id, elementId: first.id },
      { layerId: layer.id, elementId: second.id }
    ];

    expect(state.controller.editSelectedElementStyles((style) => ({
      ...style,
      fill: { type: 'solid', color: [0.25, 0.5, 0.75, 1] },
      stroke: style.stroke ? { ...style.stroke, width: 9 } : null
    }))).toBe(true);
    expect(state.history).toHaveLength(1);
    const updated = findDocumentLayer(state.document, layer.id);
    if (updated?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(updated.elements.map(({ style, styleRevision }) => ({
      fill: style.fill && !('kind' in style.fill) ? style.fill.color : null,
      width: style.stroke?.width,
      styleRevision
    }))).toEqual([
      { fill: [0.25, 0.5, 0.75, 1], width: 9, styleRevision: 1 },
      { fill: [0.25, 0.5, 0.75, 1], width: 9, styleRevision: 1 }
    ]);
  });

  it('edits selected live-shape geometry as one revisioned history command', () => {
    const state = setup();
    const rectangle = createVectorLiveShape('rectangle', {
      kind: 'rectangle', width: 20, height: 30,
      cornerRadii: [0, 0, 0, 0], linkedCorners: true
    });
    const path = createVectorPath('path', 'Path', [
      createSubpath('subpath', [createAnchor('anchor', { x: 2, y: 3 })])
    ]);
    const layer = createVectorLayer([rectangle, path]);
    state.document.layers = [layer];
    state.selection.elements = [
      { layerId: layer.id, elementId: rectangle.id },
      { layerId: layer.id, elementId: path.id }
    ];

    expect(state.controller.editSelectedLiveShapes((shape) => ({
      ...shape,
      geometry: shape.geometry.kind === 'rectangle'
        ? { ...shape.geometry, width: 120, height: 80, cornerRadii: [8, 8, 8, 8] }
        : shape.geometry
    }))).toBe(true);
    expect(state.history).toHaveLength(1);
    const updated = findDocumentLayer(state.document, layer.id);
    if (updated?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(updated.elements[0]).toMatchObject({
      type: 'live-shape',
      geometry: { width: 120, height: 80, cornerRadii: [8, 8, 8, 8] },
      geometryRevision: 1
    });
    expect(updated.elements[1]).toEqual(path);
  });

  it('cancels a provisional live shape when the active document changes', () => {
    const state = setup();
    const opening = state.document;
    state.controller.activate('live-shape');
    state.controller.pointerDown(3, { x: 10, y: 10 }, { hitRadius: 2 });
    state.controller.pointerMove(3, { x: 50, y: 40 });
    expect(state.document).not.toBe(opening);

    state.document = createImageDocument('Replacement', 50, 50, 'replacement');
    expect(state.controller.pointerMove(3, { x: 60, y: 50 })).toBe(false);
    expect(state.document.name).toBe('Replacement');
    expect(state.history).toHaveLength(0);
  });

  it('cancels only the active pen pointer gesture and can continue the path', () => {
    const state = setup();
    state.controller.activate('pen');
    state.controller.pointerDown(1, { x: 10, y: 10 }, { hitRadius: 3 });
    expect(state.controller.pointerCancel(1)).toBe(true);
    expect(state.controller.pointerDown(2, { x: 20, y: 20 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerUp(2, { x: 20, y: 20 })).toBe(true);
  });

  it('finishes a viable pen path when switching tools', () => {
    const state = setup();
    state.controller.activate('pen');
    for (const [index, point] of [{ x: 10, y: 10 }, { x: 70, y: 30 }].entries()) {
      state.controller.pointerDown(index, point, { hitRadius: 3 });
      state.controller.pointerUp(index, point);
    }

    expect(state.controller.activate('direct-selection')).toBe(true);
    expect(state.history).toHaveLength(1);
  });

  it('does not leak pointer state into a replacement document', () => {
    const state = setup();
    state.controller.activate('pen');
    state.controller.pointerDown(1, { x: 10, y: 10 }, { hitRadius: 3 });
    state.controller.pointerUp(1, { x: 10, y: 10 });
    state.document = createImageDocument('Replacement', 50, 50, 'replacement');

    expect(state.controller.pointerDown(2, { x: 5, y: 5 }, { hitRadius: 2 })).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.document.name).toBe('Replacement');
  });

  it('captures and releases a blank direct-selection marquee', () => {
    const state = setup();
    state.document.layers = [createVectorLayer([createVectorPath('path', 'Path', [
      createSubpath('subpath', [createAnchor('anchor', { x: 50, y: 30 })])
    ])])];
    state.controller.activate('direct-selection');

    expect(state.controller.pointerDown(8, { x: 40, y: 20 }, { hitRadius: 2 })).toBe(true);
    expect(state.controller.ownsPointer(8)).toBe(true);
    state.controller.pointerMove(8, { x: 60, y: 40 });
    expect(state.controller.directSelectionMarquee()).toEqual({
      x: 40,
      y: 20,
      width: 20,
      height: 20
    });
    expect(state.controller.pointerUp(8, { x: 60, y: 40 })).toBe(true);
    expect(state.controller.ownsPointer(8)).toBe(false);
    expect(state.selection.anchors.map(({ anchorId }) => anchorId)).toEqual(['anchor']);
  });

  it('routes atomic selection commands through the document-owned tool session', () => {
    const state = setup();
    const layer = createVectorLayer([createVectorPath('path', 'Path', [
      createSubpath('subpath', [
        createAnchor('first', { x: 20, y: 20 }),
        createAnchor('second', { x: 80, y: 20 })
      ])
    ])]);
    state.document.layers = [layer];
    state.controller.activate('direct-selection');
    state.controller.pointerDown(1, { x: 20, y: 20 }, { hitRadius: 2 });
    state.controller.pointerUp(1, { x: 20, y: 20 });

    expect(state.controller.nudgeSelection({ x: 4, y: -3 })).toBe(true);
    expect(state.controller.setSelectedAnchorMode('symmetric')).toBe(true);
    expect(state.history).toHaveLength(2);
    const updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors[0]?.position ?? null)
      .toEqual({ x: 24, y: 17 });

    expect(state.controller.deleteSelection()).toBe(true);
    expect(state.history).toHaveLength(3);
    expect(state.selection).toEqual(createVectorEditorSelection());
  });

  it('does not run a keyboard command through an active pointer mutation', () => {
    const state = setup();
    state.document.layers = [createVectorLayer([createVectorPath('path', 'Path', [
      createSubpath('subpath', [createAnchor('anchor', { x: 50, y: 30 })])
    ])])];
    state.controller.activate('direct-selection');
    state.controller.pointerDown(8, { x: 50, y: 30 }, { hitRadius: 2 });

    expect(state.controller.nudgeSelection({ x: 1, y: 0 })).toBe(false);
    expect(state.history).toHaveLength(0);
    state.controller.pointerCancel(8);
  });

  it('adds and deletes anchors through exact one-shot point tools', () => {
    const state = setup();
    const layer = createVectorLayer([createVectorPath('path', 'Path', [
      createSubpath('subpath', [
        createAnchor('first', { x: 20, y: 20 }),
        createAnchor('second', { x: 80, y: 20 })
      ])
    ])]);
    state.document.layers = [layer];
    state.controller.activate('add-anchor');

    expect(state.controller.pointerDown(1, { x: 50, y: 20 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.ownsPointer(1)).toBe(false);
    expect(state.history).toHaveLength(1);
    let updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors ?? []).toHaveLength(3);

    state.controller.activate('delete-anchor');
    expect(state.controller.pointerDown(2, { x: 50, y: 20 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.ownsPointer(2)).toBe(false);
    expect(state.history).toHaveLength(2);
    updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors.map(({ id }) => id) ?? [])
      .toEqual(['first', 'second']);
  });

  it('auto-adds and deletes anchors while the base Pen tool is active', () => {
    const state = setup();
    const layer = createVectorLayer([createVectorPath('path', 'Path', [
      createSubpath('subpath', [
        createAnchor('first', { x: 20, y: 20 }),
        createAnchor('second', { x: 80, y: 20 })
      ])
    ])]);
    state.document.layers = [layer];
    state.controller.activate('pen');

    expect(state.controller.pointerDown(30, { x: 50, y: 20 }, {
      hitRadius: 3, autoAddDelete: true
    })).toBe(true);
    expect(state.controller.ownsPointer(30)).toBe(false);
    let updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors).toHaveLength(3);

    expect(state.controller.pointerDown(31, { x: 50, y: 20 }, {
      hitRadius: 3, autoAddDelete: true
    })).toBe(true);
    updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors.map(({ id }) => id))
      .toEqual(['first', 'second']);
  });

  it('converts an anchor click or drag as one transform-safe history command', () => {
    const state = setup();
    const path = createVectorPath('path', 'Path', [createSubpath('subpath', [
      createAnchor('first', { x: 20, y: 20 }, {
        mode: 'smooth',
        handleIn: { x: 10, y: 20 },
        handleOut: { x: 30, y: 20 }
      }),
      createAnchor('second', { x: 80, y: 20 })
    ])]);
    path.transform = { a: 2, b: 0, c: 0, d: 2, tx: 10, ty: 5 };
    const layer = createVectorLayer([path]);
    state.document.layers = [layer];
    state.controller.activate('convert-anchor');

    expect(state.controller.pointerDown(3, { x: 50, y: 45 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerUp(3, { x: 50, y: 45 })).toBe(true);
    expect(state.history).toHaveLength(1);
    let updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors[0] ?? null)
      .toMatchObject({ mode: 'corner', handleIn: null, handleOut: null });

    expect(state.controller.pointerDown(4, { x: 50, y: 45 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.ownsPointer(4)).toBe(true);
    state.controller.pointerMove(4, { x: 70, y: 65 });
    expect(state.controller.pointerUp(4, { x: 70, y: 65 })).toBe(true);
    expect(state.history).toHaveLength(2);
    updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors[0] ?? null).toMatchObject({
        mode: 'symmetric',
        handleOut: { x: 30, y: 30 },
        handleIn: { x: 10, y: 10 }
      });
  });

  it('resumes a transformed open path endpoint as one mutation transaction', () => {
    const state = setup();
    const path = createVectorPath('existing', 'Existing', [createSubpath('open', [
      createAnchor('first', { x: 10, y: 10 }),
      createAnchor('last', { x: 40, y: 10 })
    ])]);
    path.transform = { a: 2, b: 0, c: 0, d: 2, tx: 5, ty: 7 };
    const layer = createVectorLayer([path]);
    state.document.layers = [layer];
    state.controller.activate('pen');

    // First click takes ownership of the existing endpoint, but does not add
    // a duplicate anchor or start a second history command.
    expect(state.controller.pointerDown(1, { x: 85, y: 27 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.ownsPointer(1)).toBe(false);
    expect(state.history).toHaveLength(0);

    expect(state.controller.pointerDown(2, { x: 125, y: 67 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerUp(2, { x: 125, y: 67 })).toBe(true);
    expect(state.controller.finishPenPath()).toBe(true);
    expect(state.history).toHaveLength(1);
    const updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors.map(({ position }) => position) ?? []).toEqual([
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 60, y: 30 }
      ]);
    expect(layerPaths(updated)[0]?.transform ?? null).toEqual(path.transform);
  });

  it('restores an existing path exactly when a resumed pen edit is cancelled', () => {
    const state = setup();
    const path = createVectorPath('existing', 'Existing', [createSubpath('open', [
      createAnchor('first', { x: 10, y: 10 }),
      createAnchor('last', { x: 40, y: 10 })
    ])]);
    const layer = createVectorLayer([path]);
    state.document.layers = [layer];
    const opening = state.document;
    state.controller.activate('pen');
    state.controller.pointerDown(1, { x: 10, y: 10 }, { hitRadius: 3 });
    state.controller.pointerDown(2, { x: -20, y: 25 }, { hitRadius: 3 });
    state.controller.pointerUp(2, { x: -20, y: 25 });

    expect(state.controller.cancelPenPath()).toBe(true);
    expect(state.document).toBe(opening);
    expect(state.history).toHaveLength(0);
  });

  it('connects transformed endpoints across layers as one atomic Pen command', () => {
    const state = setup();
    const activePath = createVectorPath('active-path', 'Active', [createSubpath('active-open', [
      createAnchor('active-first', { x: 10, y: 10 }),
      createAnchor('active-end', { x: 40, y: 10 })
    ])]);
    activePath.transform = { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 0 };
    const activeLayer = createVectorLayer([activePath]);
    activeLayer.transform = { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 0 };

    const targetPath = createVectorPath('target-path', 'Target', [
      createSubpath('target-open', [
        createAnchor('target-start', { x: 0, y: 10 }),
        createAnchor('target-end', { x: 30, y: 10 })
      ]),
      createSubpath('target-sibling', [
        createAnchor('target-sibling-anchor', { x: 20, y: 30 })
      ])
    ]);
    const targetLayer = createVectorLayer([targetPath]);
    targetLayer.transform = { a: 1, b: 0, c: 0, d: 1, tx: 100, ty: 0 };
    state.document.layers = [activeLayer, targetLayer];
    state.controller.activate('pen');

    // Resume active-path at document x=55, then connect to target-path at
    // document x=100. Neither endpoint is duplicated and the complete target
    // compound geometry transfers into active-path's local coordinate space.
    expect(state.controller.pointerDown(1, { x: 55, y: 10 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerDown(2, { x: 100, y: 10 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.ownsPointer(2)).toBe(false);
    expect(state.history).toHaveLength(1);

    const updatedActive = findDocumentLayer(state.document, activeLayer.id);
    const updatedTarget = findDocumentLayer(state.document, targetLayer.id);
    expect(layerPaths(updatedActive)[0]?.subpaths.map(({ id }) => id) ?? [])
      .toEqual(['active-open', 'target-sibling']);
    expect(layerPaths(updatedActive)[0]?.subpaths[0]?.anchors.map(({ id, position }) => ({ id, position })) ?? [])
      .toEqual([
        { id: 'active-first', position: { x: 10, y: 10 } },
        { id: 'active-end', position: { x: 40, y: 10 } },
        { id: 'target-start', position: { x: 85, y: 10 } },
        { id: 'target-end', position: { x: 115, y: 10 } }
      ]);
    expect(layerPaths(updatedTarget)).toEqual([]);
  });

  it('connects a newly drawn path into an existing endpoint without interim history', () => {
    const state = setup();
    const existing = createVectorPath('existing', 'Existing', [createSubpath('existing-open', [
      createAnchor('existing-start', { x: 60, y: 20 }),
      createAnchor('existing-end', { x: 100, y: 20 })
    ])]);
    const layer = createVectorLayer([existing]);
    state.document.layers = [layer];
    state.document.activeLayerId = layer.id;
    state.controller.activate('pen');

    expect(state.controller.pointerDown(1, { x: 10, y: 20 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.pointerUp(1, { x: 10, y: 20 })).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.controller.pointerDown(2, { x: 60, y: 20 }, { hitRadius: 3 })).toBe(true);
    expect(state.history).toHaveLength(1);

    const updated = findDocumentLayer(state.document, layer.id);
    expect(layerPaths(updated)).toHaveLength(1);
    expect(layerPaths(updated)[0]?.subpaths[0]?.anchors.map(({ id, position }) => ({ id, position })) ?? [])
      .toEqual([
        { id: 'anchor-3', position: { x: 10, y: 20 } },
        { id: 'existing-start', position: { x: 60, y: 20 } },
        { id: 'existing-end', position: { x: 100, y: 20 } }
      ]);
  });
});
