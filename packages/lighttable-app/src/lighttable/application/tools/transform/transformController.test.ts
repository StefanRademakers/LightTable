import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  createTextLayerNode,
  type RasterLayer
} from '../../../editor/document/documentTypes';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import {
  identityMatrix,
  translationMatrix
} from '../../../editor/tools/transform/affine';
import {
  TransformController,
  type TransformRendererPort
} from './transformController';

const coverage = {
  coreBounds: { x: 10, y: 12, width: 50, height: 40 },
  supportBounds: { x: 8, y: 10, width: 54, height: 44 },
  peakCoverage: 1
};

const pixelEdit = (): ReversiblePixelEdit => ({
  byteSize: 64,
  undo: () => true,
  redo: () => true,
  destroy: () => undefined
});

const renderer = (): TransformRendererPort => ({
  measureSelectedLayerContent: vi.fn(async () => coverage),
  measureLayerContent: vi.fn(async () => coverage),
  beginLayerTransform: vi.fn(),
  setDuplicateLayerTransform: vi.fn(() => true),
  updateLayerTransform: vi.fn(() => true),
  updateLayerProjectiveTransform: vi.fn(() => true),
  commitLayerTransform: vi.fn(pixelEdit),
  cancelLayerTransform: vi.fn(),
  measureSemanticLayerContent: vi.fn(async () => coverage),
  beginSemanticLayerTransform: vi.fn(() => true),
  updateSemanticLayerTransform: vi.fn(() => true),
  cancelSemanticLayerTransform: vi.fn()
});

const selection = (): SelectionOperation[] => [{
  mode: 'replace',
  shape: {
    kind: 'rectangle',
    points: [{ x: 5, y: 6 }, { x: 20, y: 30 }]
  }
}];

describe('TransformController', () => {
  it('previews and commits text transforms semantically without a pixel edit', async () => {
    const document = createImageDocument('Text transform', 320, 180, 'asset');
    const text = createTextLayerNode(createDefaultTextLayerData(), 'Headline');
    document.layers = [text];
    document.activeLayerId = text.id;
    const port = renderer();
    const controller = new TransformController(port);

    const launch = await controller.begin(document, []);
    expect(launch.ok).toBe(true);
    if (launch.ok) expect(launch.state.previewKind).toBe('semantic');
    expect(port.beginSemanticLayerTransform).toHaveBeenCalledWith(text);

    controller.update(translationMatrix(18, 7));
    const result = controller.finish(document, [], true);

    expect(result.kind).toBe('layer');
    if (result.kind === 'layer') {
      expect(result.afterDocument.layers[0]?.transform).toEqual(translationMatrix(18, 7));
    }
    expect(port.commitLayerTransform).not.toHaveBeenCalled();
    expect(port.cancelSemanticLayerTransform).toHaveBeenCalledWith(text);
  });

  it('starts a selected-pixel preview only for an identity layer transform', async () => {
    const document = createImageDocument('Transform', 320, 180, 'asset');
    const port = renderer();
    const controller = new TransformController(port);
    const result = await controller.begin(document, selection());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.sourceKind).toBe('selection');
    expect(port.measureSelectedLayerContent).toHaveBeenCalledOnce();
    expect(port.beginLayerTransform).toHaveBeenCalledWith(document.layers[0], true);
  });

  it('keeps a transformed layer non-destructive instead of mixing selection spaces', async () => {
    const base = createImageDocument('Transform', 320, 180, 'asset');
    const layer = base.layers[0] as RasterLayer;
    const transformed = {
      ...base,
      layers: [{ ...layer, transform: translationMatrix(12, -3) }]
    };
    const port = renderer();
    const controller = new TransformController(port);
    const result = await controller.begin(transformed, selection());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.sourceKind).toBe('layer');
      expect(result.notice).toContain('rasterize');
    }
    expect(port.measureSelectedLayerContent).not.toHaveBeenCalled();
  });

  it('falls back to visible layer content when the selection misses all pixels', async () => {
    const document = createImageDocument('Transform', 320, 180, 'asset');
    const port = renderer();
    vi.mocked(port.measureSelectedLayerContent).mockResolvedValue(null);
    const controller = new TransformController(port);
    const result = await controller.begin(document, selection());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.sourceKind).toBe('layer');
    expect(port.measureLayerContent).toHaveBeenCalledOnce();
  });

  it('commits a complete-layer transform as document geometry without baking pixels', async () => {
    const document = createImageDocument('Transform', 320, 180, 'asset');
    const port = renderer();
    const controller = new TransformController(port);
    await controller.begin(document, []);
    controller.update(translationMatrix(14, 9));
    const result = controller.finish(document, [], true);

    expect(result.kind).toBe('layer');
    if (result.kind === 'layer') {
      expect((result.afterDocument.layers[0] as RasterLayer).transform).toMatchObject({
        tx: 14,
        ty: 9
      });
      expect((result.afterDocument.layers[0] as RasterLayer).pixelRevision).toBe(0);
    }
    expect(port.commitLayerTransform).not.toHaveBeenCalled();
    expect(port.cancelLayerTransform).toHaveBeenCalledOnce();
  });

  it('commits selected pixels and their selection outline as one reversible result', async () => {
    const document = createImageDocument('Transform', 320, 180, 'asset');
    const port = renderer();
    const controller = new TransformController(port);
    await controller.begin(document, selection());
    controller.update(translationMatrix(7, 4));
    const result = controller.finish(document, selection(), true);

    expect(result.kind).toBe('selection');
    if (result.kind === 'selection') {
      expect((result.afterDocument.layers[0] as RasterLayer).pixelRevision).toBe(1);
      expect(result.afterSelection).toHaveLength(2);
      expect(result.afterSelection[1].mode).toBe('transform');
      expect(result.afterSelection[1].transform).toMatchObject({ tx: 7, ty: 4 });
      expect(result.pixelEdit.byteSize).toBe(64);
    }
  });

  it('enables copy-on-move only for selected-pixel transforms', async () => {
    const document = createImageDocument('Transform', 320, 180, 'asset');
    const port = renderer();
    const controller = new TransformController(port);
    await controller.begin(document, selection());

    expect(controller.setDuplicate(true)).toBe(true);
    expect(port.setDuplicateLayerTransform).toHaveBeenCalledWith(true);
  });

  it('previews and bakes a projective corner transform as one pixel edit', async () => {
    const base = createImageDocument('Transform', 320, 180, 'asset');
    const layer = base.layers[0] as RasterLayer;
    const document = {
      ...base,
      layers: [{ ...layer, transform: translationMatrix(12, -3) }]
    };
    const port = renderer();
    const controller = new TransformController(port);
    const launch = await controller.begin(document, []);

    expect(launch.ok).toBe(true);
    const destination = [
      { x: 18, y: 5 },
      { x: 77, y: 9 },
      { x: 70, y: 54 },
      { x: 13, y: 50 }
    ] as const;
    const state = controller.updateProjective(destination);
    expect(state?.projectiveQuad).toEqual(destination);
    expect(port.updateLayerProjectiveTransform).toHaveBeenLastCalledWith([
      { x: 10, y: 12 },
      { x: 60, y: 12 },
      { x: 60, y: 52 },
      { x: 10, y: 52 }
    ], destination);

    const result = controller.finish(document, [], true);
    expect(result.kind).toBe('selection');
    if (result.kind === 'selection') {
      expect((result.afterDocument.layers[0] as RasterLayer).transform).toEqual(identityMatrix());
      expect((result.afterDocument.layers[0] as RasterLayer).pixelRevision).toBe(1);
    }
    expect(port.commitLayerTransform).toHaveBeenCalledOnce();
  });

  it('cancels stale async launches without opening a renderer preview', async () => {
    const document = createImageDocument('Transform', 320, 180, 'asset');
    let resolveCoverage: (value: typeof coverage) => void = () => undefined;
    const port = renderer();
    vi.mocked(port.measureLayerContent).mockImplementation(() => new Promise((resolve) => {
      resolveCoverage = resolve;
    }));
    const controller = new TransformController(port);
    const pending = controller.begin(document, []);
    controller.invalidatePendingLaunch();
    resolveCoverage(coverage);
    const result = await pending;

    expect(result).toEqual({ ok: false, code: 'stale', message: null });
    expect(port.beginLayerTransform).not.toHaveBeenCalled();
    expect(controller.state).toBeNull();
  });

  it('cancels a preview when the matrix is unchanged', async () => {
    const document = createImageDocument('Transform', 320, 180, 'asset');
    const port = renderer();
    const controller = new TransformController(port);
    await controller.begin(document, []);
    controller.update(identityMatrix());
    expect(controller.finish(document, [], true)).toEqual({ kind: 'unchanged' });
    expect(port.cancelLayerTransform).toHaveBeenCalledOnce();
  });
});
