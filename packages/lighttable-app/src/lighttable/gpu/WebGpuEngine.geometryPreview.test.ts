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
});
