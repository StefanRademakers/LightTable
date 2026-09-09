import { describe, expect, it, vi } from 'vitest';
import { WebGpuEngine } from './WebGpuEngine';

describe('WebGpuEngine presentation ownership', () => {
  it('drops document interaction projections at detach without touching canonical repositories', () => {
    const setSelectionVisible = vi.fn();
    const setSmartSelectionMask = vi.fn();
    const clearSceneCache = vi.fn();
    const canonicalLayers = { release: vi.fn() };
    const canonicalPatterns = { release: vi.fn() };
    const canonicalLookups = { release: vi.fn() };
    const engine = {
      paintInteractionActive: true,
      warpInteractionActive: true,
      pendingTextInteractionTrace: { inputId: 1 },
      vectorSelection: { layerIds: ['old-layer'], pointIds: ['old-point'] },
      vectorSelectionPreviewTransform: { a: 1, b: 0, c: 0, d: 1, tx: 12, ty: 9 },
      vectorEditingSceneCache: { clear: clearSceneCache },
      selectionOverlayOperations: [{ id: 'old-selection' }],
      selectionPreviewProjectionActive: true,
      selectionPreviewTranslation: { x: 12, y: 9 },
      selectionOverlayDraft: { kind: 'rectangle', points: [] },
      selectionOverlayVisible: true,
      selectionPaintOverlayVisible: true,
      selectionAntsAnimator: { setSelectionVisible },
      smartSelectionOverlayBackend: { setMask: setSmartSelectionMask },
      textEditingOverlay: { resourceKey: 'old-text' },
      textCaretVisible: false,
      zoomOverlayDraft: { kind: 'rectangle', points: [] },
      brushCursorOverlay: { center: { x: 1, y: 1 }, diameter: 10 },
      penRubberBand: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
      penEditingOverlay: { resourceKey: 'old-pen' },
      faceWarpEditingOverlay: { resourceKey: 'old-warp' },
      faceWarpInteractionMode: 'sculpt',
      transformEditingFrame: { bounds: {} },
      smartGuideEditingFrame: { bounds: {} },
      documentGuideEditingFrame: { bounds: {} },
      documentGridEditingFrame: { bounds: {} },
      documentLayerResources: canonicalLayers,
      documentPatternResources: canonicalPatterns,
      documentColorLookupResources: canonicalLookups
    } as unknown as WebGpuEngine;

    (WebGpuEngine.prototype as unknown as {
      clearDocumentInteractionPresentation(this: WebGpuEngine): void;
    }).clearDocumentInteractionPresentation.call(engine);

    const detached = engine as unknown as Record<string, unknown>;
    expect(detached.paintInteractionActive).toBe(false);
    expect(detached.warpInteractionActive).toBe(false);
    expect(detached.pendingTextInteractionTrace).toBeNull();
    expect(detached.vectorSelection).toEqual({
      elements: [], paths: [], anchors: [], active: null
    });
    expect(detached.vectorSelectionPreviewTransform).toBeNull();
    expect(clearSceneCache).toHaveBeenCalledOnce();
    expect(detached.selectionOverlayOperations).toEqual([]);
    expect(detached.selectionPreviewProjectionActive).toBe(false);
    expect(detached.selectionPreviewTranslation).toEqual({ x: 0, y: 0 });
    expect(detached.selectionOverlayDraft).toBeNull();
    expect(detached.selectionOverlayVisible).toBe(false);
    expect(detached.selectionPaintOverlayVisible).toBe(false);
    expect(setSelectionVisible).toHaveBeenCalledWith(false);
    expect(setSmartSelectionMask).toHaveBeenCalledWith(null);
    expect(detached.textEditingOverlay).toBeNull();
    expect(detached.textCaretVisible).toBe(true);
    expect(detached.zoomOverlayDraft).toBeNull();
    expect(detached.brushCursorOverlay).toBeNull();
    expect(detached.penRubberBand).toBeNull();
    expect(detached.penEditingOverlay).toBeNull();
    expect(detached.faceWarpEditingOverlay).toBeNull();
    expect(detached.faceWarpInteractionMode).toBeNull();
    expect(detached.transformEditingFrame).toBeNull();
    expect(detached.smartGuideEditingFrame).toBeNull();
    expect(detached.documentGuideEditingFrame).toBeNull();
    expect(detached.documentGridEditingFrame).toBeNull();
    expect(canonicalLayers.release).not.toHaveBeenCalled();
    expect(canonicalPatterns.release).not.toHaveBeenCalled();
    expect(canonicalLookups.release).not.toHaveBeenCalled();
  });

  it('retires waiters and histogram publication when callbacks move to a new document', async () => {
    const invalidatePendingPublication = vi.fn();
    const requestRender = vi.fn();
    const engine = {
      callbacks: {},
      presentationGeneration: 0,
      presentationWaiters: new Set(),
      histogramRuntime: { invalidatePendingPublication },
      destroyed: false,
      requestRender
    } as unknown as WebGpuEngine;

    const stalePresentation = WebGpuEngine.prototype.waitForPresentation.call(engine);
    const callbacks = { onFirstFrame: vi.fn() };
    WebGpuEngine.prototype.updateCallbacks.call(engine, callbacks);
    await stalePresentation;

    expect(invalidatePendingPublication).toHaveBeenCalledOnce();
    expect(requestRender).toHaveBeenCalledOnce();
    expect((engine as unknown as { callbacks: unknown }).callbacks).toBe(callbacks);
    expect((engine as unknown as { presentationWaiters: Set<unknown> })
      .presentationWaiters.size).toBe(0);
  });

  it('re-arms first-frame ownership when suspend retires an in-flight completion', () => {
    const staleWaiter = { generation: 4, resolve: vi.fn() };
    const engine = {
      active: true,
      destroyed: false,
      presentationGeneration: 4,
      presentationWaiters: new Set([staleWaiter]),
      firstFramePending: false,
      firstFrameCompletionGeneration: 4,
      renderScheduler: { setPaused: vi.fn() },
      selectionAntsAnimator: { setActive: vi.fn() },
      documentRenderer: { setActive: vi.fn() }
    } as unknown as WebGpuEngine;

    WebGpuEngine.prototype.setActive.call(engine, false);

    expect((engine as unknown as { presentationGeneration: number })
      .presentationGeneration).toBe(5);
    expect((engine as unknown as { firstFramePending: boolean })
      .firstFramePending).toBe(true);
    expect((engine as unknown as { firstFrameCompletionGeneration: number | null })
      .firstFrameCompletionGeneration).toBeNull();
    expect(staleWaiter.resolve).toHaveBeenCalledOnce();
    expect((engine as unknown as { presentationWaiters: Set<unknown> })
      .presentationWaiters.size).toBe(0);
  });
});
