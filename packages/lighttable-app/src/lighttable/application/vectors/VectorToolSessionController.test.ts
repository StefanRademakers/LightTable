import { describe, expect, it } from 'vitest';
import type { VectorIdSource } from '@lighttable/vector-core';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { createImageDocument, createVectorLayer } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createVectorEditorSelection,
  type VectorEditorSelection
} from '../../editor/session/editorSession';
import { VectorToolSessionController } from './VectorToolSessionController';

const ids = (): VectorIdSource => {
  let value = 0;
  return { next: (kind) => `${kind}-${++value}` };
};

const setup = () => {
  let document = createImageDocument('Vector tools', 200, 100, 'asset');
  let selection: VectorEditorSelection = createVectorEditorSelection();
  const history: Array<{ before: typeof document; after: typeof document }> = [];
  const controller = new VectorToolSessionController({
    getDocument: () => document,
    applyDocumentSnapshot: (next) => { document = next; },
    pushDocumentHistory: (before, after) => history.push({ before, after }),
    getSelection: () => selection,
    setSelection: (next) => { selection = next; }
  }, { ids: ids() });
  return {
    controller,
    history,
    get document() { return document; },
    set document(next) { document = next; },
    get selection() { return selection; }
  };
};

describe('VectorToolSessionController', () => {
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
    expect(layer?.type === 'vector' ? layer.paths[0]?.subpaths[0]?.anchors : []).toHaveLength(2);
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
    expect(layer?.type === 'vector' ? layer.paths[0]?.subpaths[0]?.closed : false).toBe(true);
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
    expect(updated?.type === 'vector'
      ? updated.paths[0]?.subpaths[0]?.anchors[0]?.position
      : null).toEqual({ x: 24, y: 17 });

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
    expect(updated?.type === 'vector'
      ? updated.paths[0].subpaths[0].anchors
      : []).toHaveLength(3);

    state.controller.activate('delete-anchor');
    expect(state.controller.pointerDown(2, { x: 50, y: 20 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.ownsPointer(2)).toBe(false);
    expect(state.history).toHaveLength(2);
    updated = findDocumentLayer(state.document, layer.id);
    expect(updated?.type === 'vector'
      ? updated.paths[0].subpaths[0].anchors.map(({ id }) => id)
      : []).toEqual(['first', 'second']);
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
    expect(updated?.type === 'vector'
      ? updated.paths[0].subpaths[0].anchors[0]
      : null).toMatchObject({ mode: 'corner', handleIn: null, handleOut: null });

    expect(state.controller.pointerDown(4, { x: 50, y: 45 }, { hitRadius: 3 })).toBe(true);
    expect(state.controller.ownsPointer(4)).toBe(true);
    state.controller.pointerMove(4, { x: 70, y: 65 });
    expect(state.controller.pointerUp(4, { x: 70, y: 65 })).toBe(true);
    expect(state.history).toHaveLength(2);
    updated = findDocumentLayer(state.document, layer.id);
    expect(updated?.type === 'vector'
      ? updated.paths[0].subpaths[0].anchors[0]
      : null).toMatchObject({
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
    expect(updated?.type === 'vector'
      ? updated.paths[0].subpaths[0].anchors.map(({ position }) => position)
      : []).toEqual([
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 60, y: 30 }
      ]);
    expect(updated?.type === 'vector' ? updated.paths[0].transform : null).toEqual(path.transform);
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
});
