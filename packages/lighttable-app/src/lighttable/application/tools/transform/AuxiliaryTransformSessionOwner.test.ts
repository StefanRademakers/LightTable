import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { identityMatrix } from '../../../editor/tools/transform/affine';
import { addLayerMask } from '../../../editor/document/documentCommands';
import { AuxiliaryTransformSessionOwner } from './AuxiliaryTransformSessionOwner';

describe('AuxiliaryTransformSessionOwner', () => {
  it('binds group preview, commit and cleanup to one renderer generation', () => {
    const before = createImageDocument('group', 100, 80, 'source');
    const renderer = {
      updateLayerGeometryPreviews: vi.fn(() => true),
      clearLayerGeometryPreviews: vi.fn(() => true)
    };
    let generation = 1;
    const owner = new AuxiliaryTransformSessionOwner(() => ({ renderer, rendererGeneration: generation }));
    owner.admitGroup({
      before, renderer, rendererGeneration: 1,
      layerIds: [before.activeLayerId!], requestedSelectionKey: before.activeLayerId!,
      bounds: { x: 0, y: 0, width: 100, height: 80 }
    });
    expect(owner.update({ ...identityMatrix(), tx: 10 })).toBe(true);
    generation = 2;
    expect(owner.update({ ...identityMatrix(), tx: 20 })).toBe(false);
    expect(owner.finish(true, before)).toEqual({ kind: 'cancelled' });
    expect(renderer.clearLayerGeometryPreviews).not.toHaveBeenCalled();
  });

  it('publishes a linked mask as one document transform plan', () => {
    const base = createImageDocument('mask', 100, 80, 'source');
    const layer = base.layers[0]!;
    const before = addLayerMask(base, layer.id);
    const renderer = {
      updateLayerGeometryPreviews: vi.fn(() => true),
      clearLayerGeometryPreviews: vi.fn(() => true),
      updateLayerMaskGeometryPreview: vi.fn(() => true),
      clearLayerMaskGeometryPreview: vi.fn(() => true)
    };
    const owner = new AuxiliaryTransformSessionOwner(() => ({ renderer, rendererGeneration: 1 }));
    owner.admitMask({
      before, renderer, rendererGeneration: 1, layerId: layer.id,
      layerTransform: identityMatrix(), maskTransform: identityMatrix(), linked: true,
      bounds: { x: 0, y: 0, width: 100, height: 80 }
    });
    expect(owner.update({ ...identityMatrix(), tx: 7 })).toBe(true);
    const result = owner.finish(true, before);
    expect(result.kind).toBe('commit');
    if (result.kind === 'commit') {
      expect(result.target).toBe('mask');
      expect(result.after.layers[0]?.transform.tx).toBe(7);
    }
    expect(renderer.clearLayerGeometryPreviews).toHaveBeenCalledOnce();
    expect(renderer.clearLayerMaskGeometryPreview).toHaveBeenCalledOnce();
  });
});
