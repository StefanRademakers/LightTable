import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  type RasterLayer
} from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import { createEditorSession } from '../../../editor/session/editorSession';
import { identityMatrix } from '../../../editor/tools/transform/affine';
import {
  createPaintSessionController,
  type PaintSessionDependencies,
  type PaintSessionRendererPort
} from './usePaintSessionController';
import type { PaintFramePort } from './paintDabScheduler';

const createPixelEdit = (): ReversiblePixelEdit => ({
  byteSize: 64,
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  destroy: vi.fn()
});

const createFixture = (frame?: PaintFramePort) => {
  let document = createImageDocument('Paint', 100, 80, 'asset');
  const layer = document.layers[0] as RasterLayer;
  const pixelEdit = createPixelEdit();
  const renderer: PaintSessionRendererPort = {
    setPaintInteractionActive: vi.fn(),
    beginBrushStroke: vi.fn(),
    beginSampledBrushStroke: vi.fn(),
    endSampledBrushStroke: vi.fn(),
    paintBrushDabs: vi.fn(),
    finishPixelEdit: vi.fn(() => pixelEdit),
    cancelPixelEdit: vi.fn(),
    applyPixelHistory: vi.fn(() => true)
  };
  const history: Array<Parameters<PaintSessionDependencies['pushHistoryEntry']>[0]> = [];
  const dependencies: PaintSessionDependencies = {
    getDocument: () => document,
    getRenderer: () => renderer,
    applyDocumentSnapshot: vi.fn((next) => {
      document = next;
    }),
    pushHistoryEntry: (entry) => history.push(entry),
    setError: vi.fn()
  };
  return {
    controller: createPaintSessionController(() => dependencies, undefined, frame),
    dependencies,
    history,
    layer,
    pixelEdit,
    renderer,
    getDocument: () => document
  };
};

describe('PaintSessionController', () => {
  it('keeps a large coalesced recorded stroke to one frame submit, history entry and semantic commit', () => {
    let frameCallback: (() => void) | null = null;
    const request = vi.fn((callback: () => void) => {
      frameCallback = callback;
      return 31;
    });
    const cancel = vi.fn();
    const fixture = createFixture({ request, cancel });
    const onStrokeCommitted = vi.fn();
    fixture.dependencies.onStrokeCommitted = onStrokeCommitted;
    const samples = Array.from({ length: 2048 }, (_, index) => ({
      x: 5 + index / 32,
      y: 6 + index / 64,
      pressure: 0.25 + (index % 64) / 128
    }));

    expect(fixture.controller.begin({
      pointerId: 30,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: false,
        sourceToDocument: identityMatrix()
      },
      brush: createEditorSession().brush,
      point: { x: 4, y: 5, pressure: 0.5 },
      recordSemanticCommit: true
    })).toBe(true);
    expect(fixture.controller.moveMany(30, samples)).toBe(true);

    expect(request).toHaveBeenCalledOnce();
    expect(fixture.renderer.paintBrushDabs).not.toHaveBeenCalled();
    expect(fixture.history).toHaveLength(0);
    expect(onStrokeCommitted).not.toHaveBeenCalled();

    expect(fixture.controller.finish(30)).toBe(true);
    expect(cancel).toHaveBeenCalledWith(31);
    expect(fixture.renderer.paintBrushDabs).toHaveBeenCalledOnce();
    expect(fixture.history).toHaveLength(1);
    expect(onStrokeCommitted).toHaveBeenCalledOnce();
    expect(onStrokeCommitted.mock.calls[0]?.[0].samples).toHaveLength(2049);
    expect(frameCallback).not.toBeNull();
  });

  it('reports one bounded semantic stroke only after the pixel edit commits', () => {
    const onStrokeCommitted = vi.fn();
    const fixture = createFixture();
    const originalDependencies = fixture.dependencies;
    originalDependencies.onStrokeCommitted = onStrokeCommitted;
    const brush = createEditorSession().brush;
    expect(fixture.controller.begin({
      pointerId: 21,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: false,
        sourceToDocument: identityMatrix()
      },
      brush,
      point: { x: 4, y: 5, pressure: 0.5 },
      recordSemanticCommit: true
    })).toBe(true);
    expect(fixture.controller.moveMany(21, [
      { x: 8, y: 9, pressure: 0.7 },
      { x: 14, y: 12, pressure: 1 }
    ])).toBe(true);
    expect(onStrokeCommitted).not.toHaveBeenCalled();
    expect(fixture.controller.finish(21)).toBe(true);
    expect(onStrokeCommitted).toHaveBeenCalledOnce();
    expect(onStrokeCommitted).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ layerId: fixture.layer.id, channel: 'pixels', erase: false }),
      brush,
      samples: [
        { x: 4, y: 5, pressure: 0.5 },
        { x: 8, y: 9, pressure: 0.7 },
        { x: 14, y: 12, pressure: 1 }
      ]
    }));
    expect(fixture.history).toHaveLength(1);
  });

  it('records a snapshotted tone operator only after its GPU edit commits', () => {
    const onStrokeCommitted = vi.fn();
    const fixture = createFixture();
    fixture.dependencies.onStrokeCommitted = onStrokeCommitted;
    const operator = {
      operator: 'tone' as const,
      mode: 'sponge' as const,
      range: 'midtones' as const,
      spongeMode: 'desaturate' as const,
      protectTones: true,
      vibrance: false
    };
    expect(fixture.controller.begin({
      pointerId: 23,
      layer: fixture.layer,
      target: { layerId: fixture.layer.id, channel: 'pixels', erase: false,
        sourceToDocument: identityMatrix() },
      brush: { ...createEditorSession().brush, flow: 0.4 },
      point: { x: 10, y: 11, pressure: 1 },
      operator,
      recordSemanticCommit: true
    })).toBe(true);
    expect(onStrokeCommitted).not.toHaveBeenCalled();
    expect(fixture.controller.finish(23)).toBe(true);
    expect(onStrokeCommitted).toHaveBeenCalledWith(expect.objectContaining({ operator }));
    expect(fixture.history).toHaveLength(1);
    expect(vi.mocked(fixture.renderer.paintBrushDabs).mock.calls[0]?.[11]).toEqual(operator);
  });

  it('keeps painting but refuses to record an oversized UI stroke', () => {
    const onStrokeCommitted = vi.fn();
    const fixture = createFixture();
    fixture.dependencies.onStrokeCommitted = onStrokeCommitted;
    fixture.controller.begin({
      pointerId: 22,
      layer: fixture.layer,
      target: { layerId: fixture.layer.id, channel: 'pixels', erase: false,
        sourceToDocument: identityMatrix() },
      brush: createEditorSession().brush,
      point: { x: 0, y: 0, pressure: 1 },
      recordSemanticCommit: true
    });
    fixture.controller.moveMany(22, Array.from({ length: 4096 }, (_, index) => ({
      x: index / 10, y: index / 20, pressure: 1
    })));
    expect(fixture.controller.finish(22)).toBe(true);
    expect(fixture.history).toHaveLength(1);
    expect(onStrokeCommitted).not.toHaveBeenCalled();
  });

  const sampledPlan = {
    operator: 'clone' as const,
    source: {
      documentId: 'document-sampled',
      anchorLayerId: 'source-layer' as RasterLayer['id'],
      point: { x: 72, y: 18 }
    },
    sampleMode: 'current-and-below' as const,
    sourceOffset: { x: 62, y: 8 },
    diffusion: 5
  };

  it('keeps one immutable sampled source active for the whole stroke and one undo entry', () => {
    const fixture = createFixture();
    expect(fixture.controller.begin({
      pointerId: 14,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: false,
        sourceToDocument: identityMatrix()
      },
      brush: createEditorSession().brush,
      point: { x: 10, y: 10, pressure: 1 },
      operator: sampledPlan
    })).toBe(true);

    fixture.controller.move(14, { x: 20, y: 10, pressure: 1 });
    expect(fixture.controller.finish(14)).toBe(true);

    expect(fixture.renderer.beginSampledBrushStroke).toHaveBeenCalledOnce();
    expect(fixture.renderer.beginSampledBrushStroke).toHaveBeenCalledWith(sampledPlan);
    expect(fixture.renderer.paintBrushDabs).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(fixture.renderer.paintBrushDabs).mock.calls) {
      expect(call[11]).toBe(sampledPlan);
    }
    expect(fixture.renderer.endSampledBrushStroke).toHaveBeenCalledOnce();
    expect(fixture.history).toHaveLength(1);
  });

  it('releases a sampled source when its paint gesture is cancelled', () => {
    const fixture = createFixture();
    fixture.controller.begin({
      pointerId: 15,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: false,
        sourceToDocument: identityMatrix()
      },
      brush: createEditorSession().brush,
      point: { x: 10, y: 10, pressure: 1 },
      operator: { ...sampledPlan, operator: 'healing' }
    });

    expect(fixture.controller.cancel(15)).toBe(true);
    expect(fixture.renderer.endSampledBrushStroke).toHaveBeenCalledOnce();
    expect(fixture.history).toHaveLength(0);
  });

  it('treats Healing as one full patch while Clone retains brush flow', () => {
    const healing = createFixture();
    const clone = createFixture();
    const brush = { ...createEditorSession().brush, flow: 0.12 };
    const begin = (fixture: ReturnType<typeof createFixture>, operator: 'clone' | 'healing') =>
      fixture.controller.begin({
        pointerId: 16,
        layer: fixture.layer,
        target: {
          layerId: fixture.layer.id,
          channel: 'pixels', erase: false, sourceToDocument: identityMatrix()
        },
        brush,
        point: { x: 10, y: 10, pressure: 1 },
        operator: { ...sampledPlan, operator }
      });

    expect(begin(healing, 'healing')).toBe(true);
    expect(begin(clone, 'clone')).toBe(true);
    expect(vi.mocked(healing.renderer.paintBrushDabs).mock.calls[0]?.[6]).toBe(1);
    expect(vi.mocked(clone.renderer.paintBrushDabs).mock.calls[0]?.[6]).toBe(0.12);
  });

  it('locks brush settings and commits one document/history transaction', () => {
    const fixture = createFixture();
    const brush = createEditorSession().brush;
    expect(fixture.controller.begin({
      pointerId: 4,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: false,
        sourceToDocument: identityMatrix()
      },
      brush,
      point: { x: 10, y: 10, pressure: 1 }
    })).toBe(true);
    expect(fixture.history).toHaveLength(0);
    brush.color = '#ffffff';
    fixture.controller.move(4, { x: 20, y: 10, pressure: 1 });
    expect(fixture.history).toHaveLength(0);
    expect(fixture.controller.finish(4)).toBe(true);

    expect(fixture.renderer.paintBrushDabs).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fixture.renderer.paintBrushDabs).mock.calls[1]?.[3]).toEqual([0, 0, 0]);
    expect((fixture.getDocument().layers[0] as RasterLayer).pixelRevision).toBe(1);
    expect(fixture.history).toHaveLength(1);
    expect(fixture.renderer.setPaintInteractionActive)
      .toHaveBeenNthCalledWith(1, true, fixture.layer.id);
    expect(fixture.renderer.setPaintInteractionActive).toHaveBeenLastCalledWith(false);

    fixture.history[0]?.undo();
    expect(fixture.renderer.applyPixelHistory).toHaveBeenCalledWith(
      fixture.pixelEdit,
      'undo'
    );
    fixture.history[0]?.redo();
    expect(fixture.renderer.applyPixelHistory).toHaveBeenCalledWith(
      fixture.pixelEdit,
      'redo'
    );
  });

  it('rolls a cancelled gesture back without publishing document history', () => {
    const fixture = createFixture();
    fixture.controller.begin({
      pointerId: 8,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: true,
        sourceToDocument: identityMatrix()
      },
      brush: createEditorSession().brush,
      point: { x: 5, y: 5, pressure: 1 }
    });
    expect(fixture.controller.cancel(8)).toBe(true);
    expect(fixture.renderer.applyPixelHistory).toHaveBeenCalledWith(
      fixture.pixelEdit,
      'undo'
    );
    expect(fixture.pixelEdit.destroy).toHaveBeenCalledOnce();
    expect(fixture.history).toHaveLength(0);
    expect(fixture.renderer.setPaintInteractionActive)
      .toHaveBeenNthCalledWith(1, true, fixture.layer.id);
    expect(fixture.renderer.setPaintInteractionActive).toHaveBeenLastCalledWith(false);
  });

  it('keeps a captured outside-canvas stroke but clips its document dirty bounds', () => {
    const fixture = createFixture();
    const brush = { ...createEditorSession().brush, size: 20, spacing: 0.1 };
    expect(fixture.controller.begin({
      pointerId: 9,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: false,
        sourceToDocument: identityMatrix()
      },
      brush,
      point: { x: 95, y: 75, pressure: 1 }
    })).toBe(true);
    expect(fixture.controller.move(9, { x: 150, y: 120, pressure: 1 })).toBe(true);
    expect(fixture.controller.finish(9)).toBe(true);

    const layer = fixture.getDocument().layers[0] as RasterLayer;
    expect(layer.dirtyBounds).toEqual({ x: 85, y: 65, width: 15, height: 15 });
    expect(fixture.renderer.paintBrushDabs).toHaveBeenCalledTimes(2);
    expect(fixture.history).toHaveLength(1);
  });

  it('leaves interactive quality when stroke initialization fails', () => {
    const fixture = createFixture();
    vi.mocked(fixture.renderer.beginBrushStroke).mockImplementationOnce(() => {
      throw new Error('GPU edit unavailable');
    });

    expect(fixture.controller.begin({
      pointerId: 12,
      layer: fixture.layer,
      target: {
        layerId: fixture.layer.id,
        channel: 'pixels',
        erase: false,
        sourceToDocument: identityMatrix()
      },
      brush: createEditorSession().brush,
      point: { x: 5, y: 5, pressure: 1 }
    })).toBe(false);

    expect(fixture.renderer.cancelPixelEdit).toHaveBeenCalledOnce();
    expect(fixture.renderer.setPaintInteractionActive)
      .toHaveBeenNthCalledWith(1, true, fixture.layer.id);
    expect(fixture.renderer.setPaintInteractionActive).toHaveBeenLastCalledWith(false);
    expect(fixture.dependencies.setError).toHaveBeenCalledWith('GPU edit unavailable');
  });
});
