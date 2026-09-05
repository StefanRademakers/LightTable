import { describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createImageDocument, createTextLayerNode, type ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { TextLayerMoveGestureController } from './TextLayerMoveGestureController';

describe('TextLayerMoveGestureController', () => {
  it('previews and records exactly one Ctrl-drag move without ending text editing', () => {
    const layer = createTextLayerNode(createDefaultTextLayerData());
    let document: ImageDocument = { ...createImageDocument('Test', 100, 100, 'asset'), layers: [layer], activeLayerId: layer.id };
    let preview: ImageDocument | null = null;
    const pushHistoryEntry = vi.fn();
    const previewDocumentSnapshot = vi.fn((next: ImageDocument) => { preview = next; });
    const applyDocumentSnapshot = vi.fn((next: ImageDocument) => { document = next; preview = null; });
    const documentMutations = createDocumentMutationController(() => ({
      getDocument: () => document,
      previewSnapshot: previewDocumentSnapshot,
      discardPreview: () => { preview = null; },
      applySnapshot: applyDocumentSnapshot,
      pushHistoryEntry
    }));
    const controller = new TextLayerMoveGestureController(() => ({
      getDocument: () => document,
      getEditingLayerId: () => layer.id,
      documentMutations
    }));
    expect(controller.begin(7, { x: 10, y: 20 })).toBe(true);
    expect(controller.move(7, { x: 25, y: 24 })).toBe(true);
    expect(document.revision).toBe(0);
    expect(findDocumentLayer(preview!, layer.id)?.transform).toMatchObject({ tx: 15, ty: 4 });
    expect(controller.finish(7, { x: 30, y: 30 })).toBe(true);
    expect(findDocumentLayer(document, layer.id)?.transform).toMatchObject({ tx: 20, ty: 10 });
    expect(applyDocumentSnapshot).toHaveBeenCalledOnce();
    expect(pushHistoryEntry).toHaveBeenCalledTimes(1);
  });

  it('restores the exact document when cancelled', () => {
    const layer = createTextLayerNode(createDefaultTextLayerData());
    const before = { ...createImageDocument('Test', 100, 100, 'asset'), layers: [layer], activeLayerId: layer.id };
    let document: ImageDocument = before;
    let preview: ImageDocument | null = null;
    const discardDocumentPreview = vi.fn(() => { preview = null; });
    const pushHistoryEntry = vi.fn();
    const documentMutations = createDocumentMutationController(() => ({
      getDocument: () => document,
      previewSnapshot: (next: ImageDocument) => { preview = next; },
      discardPreview: discardDocumentPreview,
      applySnapshot: (next: ImageDocument) => { document = next; preview = null; },
      pushHistoryEntry
    }));
    const controller = new TextLayerMoveGestureController(() => ({
      getDocument: () => document, getEditingLayerId: () => layer.id,
      documentMutations
    }));
    controller.begin(1, { x: 0, y: 0 });
    controller.move(1, { x: 9, y: 4 });
    expect(preview).not.toBeNull();
    controller.cancel(1);
    expect(document).toBe(before);
    expect(preview).toBeNull();
    expect(discardDocumentPreview).toHaveBeenCalledOnce();
  });
});
