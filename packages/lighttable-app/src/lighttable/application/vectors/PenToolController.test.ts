import { describe, expect, it } from 'vitest';
import type { VectorIdSource } from '@lighttable/vector-core';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { VectorDocumentController } from './VectorDocumentController';
import { PenToolController } from './PenToolController';

const ids = (): VectorIdSource => {
  let value = 0;
  return { next: (kind) => `${kind}-${++value}` };
};

const setup = () => {
  let document = createImageDocument('Pen', 200, 100, 'asset');
  const history: Array<{ before: typeof document; after: typeof document }> = [];
  const documentController = new VectorDocumentController(() => ({
    getDocument: () => document,
    applyDocumentSnapshot: (next) => { document = next; },
    pushDocumentHistory: (before, after) => history.push({ before, after })
  }));
  return {
    controller: new PenToolController(documentController, { ids: ids() }),
    history,
    get document() { return document; }
  };
};

describe('PenToolController', () => {
  it('previews many anchors but commits the completed path once', () => {
    const state = setup();
    expect(state.controller.pointerDown({ x: 10, y: 10 })).toBe(true);
    expect(state.controller.pointerMove({ x: 15, y: 10 })).toBe(true);
    expect(state.controller.pointerMove({ x: 18, y: 10 })).toBe(true);
    expect(state.controller.pointerUp({ x: 18, y: 10 })).toBe(true);
    expect(state.controller.pointerDown({ x: 70, y: 30 })).toBe(true);
    expect(state.controller.pointerUp({ x: 70, y: 30 })).toBe(true);
    expect(state.history).toHaveLength(0);

    expect(state.controller.finishOpen()).toBe(true);
    expect(state.history).toHaveLength(1);
    const layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    expect(layer?.type).toBe('vector');
    if (layer?.type !== 'vector') throw new Error('Expected vector layer.');
    expect(layer.paths[0]?.subpaths[0]?.anchors).toHaveLength(2);
    expect(layer.paths[0]?.subpaths[0]?.anchors[0]).toMatchObject({
      handleIn: { x: 2, y: 10 },
      handleOut: { x: 18, y: 10 }
    });
  });

  it('closes near the first anchor and records one history entry', () => {
    const state = setup();
    for (const point of [{ x: 10, y: 10 }, { x: 80, y: 10 }, { x: 40, y: 70 }]) {
      state.controller.pointerDown(point);
      state.controller.pointerUp(point);
    }

    expect(state.controller.tryClose({ x: 12, y: 11 }, 3)).toBe(true);
    expect(state.history).toHaveLength(1);
    const layer = findDocumentLayer(state.document, state.document.activeLayerId!);
    expect(layer?.type === 'vector' ? layer.paths[0]?.subpaths[0]?.closed : false).toBe(true);
  });

  it('cancels the complete provisional layer without history', () => {
    const state = setup();
    const opening = state.document;
    state.controller.pointerDown({ x: 10, y: 10 });
    state.controller.pointerUp({ x: 10, y: 10 });

    expect(state.controller.cancel()).toBe(true);
    expect(state.document).toBe(opening);
    expect(state.history).toHaveLength(0);
  });
});
