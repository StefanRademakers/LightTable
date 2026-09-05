import { describe, expect, it, vi } from 'vitest';
import { createVectorLayer, type LayerNode } from '../editor/document/documentTypes';
import { identityMatrix } from '../editor/tools/transform/affine';
import { WebGpuEngine } from './WebGpuEngine';

const layer = (id: string): LayerNode => ({
  ...createVectorLayer([], id),
  id: id as LayerNode['id']
});

describe('WebGpuEngine geometry preview batches', () => {
  it('updates every selected layer and invalidates presentation once', () => {
    const setGeometryPreview = vi.fn(() => true);
    const markDocumentPreviewDirty = vi.fn();
    const engine = {
      documentRenderer: { setGeometryPreview },
      markDocumentPreviewDirty
    };
    const first = layer('first');
    const second = layer('second');

    expect(WebGpuEngine.prototype.updateLayerGeometryPreviews.call(engine, [
      { layer: first, matrix: { ...identityMatrix(), tx: 10 } },
      { layer: second, matrix: { ...identityMatrix(), tx: 20 } }
    ])).toBe(true);
    expect(setGeometryPreview).toHaveBeenCalledTimes(2);
    expect(markDocumentPreviewDirty).toHaveBeenCalledOnce();
  });

  it('clears a group without publishing canonical document state', () => {
    const setGeometryPreview = vi.fn(() => true);
    const markDocumentPreviewDirty = vi.fn();
    const engine = {
      documentRenderer: { setGeometryPreview },
      markDocumentPreviewDirty
    };
    const layers = [layer('first'), layer('second')];

    expect(WebGpuEngine.prototype.clearLayerGeometryPreviews.call(engine, layers)).toBe(true);
    expect(setGeometryPreview.mock.calls).toEqual([
      [layers[0], null],
      [layers[1], null]
    ]);
    expect(markDocumentPreviewDirty).toHaveBeenCalledOnce();
  });

  it('keeps mask previews renderer-only and always ends their style interaction', () => {
    const setMaskGeometryPreview = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const setLayerStyleInteractionActive = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);
    const markDocumentPreviewDirty = vi.fn();
    const engine = {
      documentRenderer: { setMaskGeometryPreview, setLayerStyleInteractionActive },
      markDocumentPreviewDirty
    };
    const target = layer('masked');
    const matrix = { ...identityMatrix(), tx: 12 };

    expect(WebGpuEngine.prototype.updateLayerMaskGeometryPreview.call(
      engine, target, matrix
    )).toBe(true);
    expect(WebGpuEngine.prototype.clearLayerMaskGeometryPreview.call(engine, target)).toBe(true);
    expect(setMaskGeometryPreview.mock.calls).toEqual([
      [target, matrix],
      [target, null]
    ]);
    expect(setLayerStyleInteractionActive.mock.calls).toEqual([
      [true, target.id],
      [false, target.id]
    ]);
    expect(markDocumentPreviewDirty).toHaveBeenCalledTimes(2);
  });

  it('invalidates the document compositor for renderer-only vector content', () => {
    const setVectorContentPreviews = vi.fn(() => true);
    const clearVectorContentPreviews = vi.fn(() => true);
    const markDocumentPreviewDirty = vi.fn();
    const engine = {
      documentRenderer: { setVectorContentPreviews, clearVectorContentPreviews },
      markDocumentPreviewDirty
    };
    const vector = layer('vector');
    if (vector.type !== 'vector') throw new Error('Expected vector fixture.');

    expect(WebGpuEngine.prototype.setVectorContentPreviews.call(engine, [vector])).toBe(true);
    expect(WebGpuEngine.prototype.clearVectorContentPreviews.call(engine)).toBe(true);
    expect(setVectorContentPreviews).toHaveBeenCalledWith([vector]);
    expect(clearVectorContentPreviews).toHaveBeenCalledOnce();
    expect(markDocumentPreviewDirty).toHaveBeenCalledTimes(2);
  });
});
