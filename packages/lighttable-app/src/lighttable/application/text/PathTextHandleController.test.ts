import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath, identityAffineMatrix } from '@lighttable/vector-core';
import { realizePathArcLength } from '@lighttable/vector-rendering';
import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, createTextLayerNode } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { setFlowTextLayout } from '../../editor/document/textLayerCommands';
import type { RigidPathGlyphProjection } from '../../text/rendering/rigidPathGlyphProjection';
import { PathTextHandleController } from './PathTextHandleController';

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

const harness = (direction: 'forward' | 'reverse' = 'forward') => {
  const layer = createTextLayerNode(createDefaultTextLayerData(), 'Path text');
  let document = createImageDocument('Text', 400, 300, 'source');
  document.layers = [layer];
  document.activeLayerId = layer.id;
  document = setFlowTextLayout(document, layer.id, {
    mode: 'path', pathLayerId: 'vector', pathElementId: 'path', pathSubpathId: 'line',
    startOffset: 10, endOffset: 90, direction, side: 'left', upright: false
  });
  const table = realizePathArcLength(createVectorPath('path', 'Line', [createSubpath('line', [
    createAnchor('a', { x: 0, y: 0 }), createAnchor('b', { x: 100, y: 0 })
  ])]), 'line', identityAffineMatrix(), 0.25);
  const projection: RigidPathGlyphProjection = {
    glyphRuns: [], linearOrigin: 0, contentAdvance: 20,
    range: { start: 10, end: 90, origin: 10, available: 80, overflow: 0, direction }
  };
  const applyDocument = vi.fn((next) => { document = next; });
  const recordHistory = vi.fn();
  const controller = new PathTextHandleController(() => ({
    getDocument: () => document,
    getEditingLayerId: () => layer.id,
    getRealization: () => ({ table, projection, localToDocument: identity }),
    applyDocument,
    recordHistory
  }));
  const layout = () => {
    const current = findDocumentLayer(document, layer.id);
    if (current?.type !== 'text' || current.text.source.kind !== 'flow'
      || current.text.source.layout.mode !== 'path') throw new Error('Expected path text.');
    return current.text.source.layout;
  };
  return { controller, applyDocument, recordHistory, getDocument: () => document, layout };
};

describe('PathTextHandleController', () => {
  it('previews offset drags from the opening snapshot and records one undo entry', () => {
    const state = harness();
    expect(state.controller.begin(7, { x: 10, y: 0 }, 5)).toBe(true);
    expect(state.controller.move(7, { x: 30, y: 4 })).toBe(true);
    expect(state.controller.finish(7, { x: 40, y: 0 })).toBe(true);
    expect(state.layout().startOffset).toBe(40);
    expect(state.applyDocument).toHaveBeenCalledTimes(2);
    expect(state.recordHistory).toHaveBeenCalledOnce();
  });

  it('converts geometric offsets into reverse traversal offsets', () => {
    const state = harness('reverse');
    expect(state.controller.begin(3, { x: 90, y: 0 }, 5)).toBe(true);
    state.controller.finish(3, { x: 70, y: 0 });
    expect(state.layout().startOffset).toBe(30);
  });

  it('toggles path direction as one undoable handle command', () => {
    const state = harness();
    expect(state.controller.begin(2, { x: 22, y: 0 }, 5)).toBe(true);
    expect(state.controller.finish(2, { x: 22, y: 0 })).toBe(true);
    expect(state.layout().direction).toBe('reverse');
    expect(state.recordHistory).toHaveBeenCalledOnce();
  });

  it('restores the exact opening document when a drag is cancelled', () => {
    const state = harness();
    const before = state.getDocument();
    state.controller.begin(5, { x: 90, y: 0 }, 5);
    state.controller.move(5, { x: 75, y: 0 });
    expect(state.controller.cancel(5)).toBe(true);
    expect(state.getDocument()).toBe(before);
    expect(state.recordHistory).not.toHaveBeenCalled();
  });
});
