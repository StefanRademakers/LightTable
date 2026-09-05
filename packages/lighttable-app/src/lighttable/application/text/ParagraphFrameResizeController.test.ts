import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createImageDocument, createTextLayerNode } from '../../editor/document/documentTypes';
import { setFlowTextLayout } from '../../editor/document/textLayerCommands';
import { ParagraphFrameResizeController } from './ParagraphFrameResizeController';

const identity = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

const harness = () => {
  const layer = createTextLayerNode(createDefaultTextLayerData(), 'Paragraph');
  let document = createImageDocument('Text', 400, 300, 'source');
  document.layers = [layer];
  document.activeLayerId = layer.id;
  document = setFlowTextLayout(document, layer.id, {
    mode: 'paragraph', frame: { x: 10, y: 20, width: 100, height: 60 },
    overflow: 'indicator', writingMode: 'horizontal-tb'
  });
  let preview = document;
  const previewDocumentSnapshot = vi.fn((next) => { preview = next; });
  const discardDocumentPreview = vi.fn(() => { preview = document; });
  const applyDocumentSnapshot = vi.fn((next) => { document = next; preview = next; });
  const recordHistory = vi.fn();
  const controller = new ParagraphFrameResizeController(() => ({
    getDocument: () => document,
    getEditingLayerId: () => layer.id,
    getLocalToDocument: () => identity,
    previewDocumentSnapshot,
    discardDocumentPreview,
    applyDocumentSnapshot,
    recordHistory
  }));
  return {
    controller,
    layer,
    getDocument: () => document,
    getPreview: () => preview,
    previewDocumentSnapshot,
    discardDocumentPreview,
    applyDocumentSnapshot,
    recordHistory
  };
};

describe('ParagraphFrameResizeController', () => {
  it('previews many pointer moves but records one history mutation', () => {
    const state = harness();
    expect(state.controller.begin(7, { x: 110, y: 80 }, 6)).toBe(true);
    expect(state.controller.move(7, { x: 140, y: 100 })).toBe(true);
    expect(state.controller.finish(7, { x: 160, y: 120 })).toBe(true);

    expect(state.previewDocumentSnapshot).toHaveBeenCalledTimes(2);
    expect(state.applyDocumentSnapshot).toHaveBeenCalledOnce();
    expect(state.recordHistory).toHaveBeenCalledOnce();
    const layer = state.getDocument().layers[0]!;
    expect(layer.type === 'text' && layer.text.source.kind === 'flow'
      ? layer.text.source.layout
      : null).toMatchObject({ frame: { x: 10, y: 20, width: 150, height: 100 } });
  });

  it('restores the opening document on pointer cancel', () => {
    const state = harness();
    const before = state.getDocument();
    state.controller.begin(4, { x: 10, y: 50 }, 6);
    state.controller.move(4, { x: 30, y: 50 });

    expect(state.getDocument()).toBe(before);
    expect(state.getPreview()).not.toBe(before);
    expect(state.controller.cancel(4)).toBe(true);
    expect(state.getDocument()).toBe(before);
    expect(state.getPreview()).toBe(before);
    expect(state.discardDocumentPreview).toHaveBeenCalledOnce();
    expect(state.recordHistory).not.toHaveBeenCalled();
  });

  it('does not steal ordinary clicks inside the frame', () => {
    const state = harness();
    expect(state.controller.begin(1, { x: 60, y: 50 }, 6)).toBe(false);
    expect(state.controller.owns(1)).toBe(false);
  });
});
