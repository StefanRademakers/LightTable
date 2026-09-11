import { describe, expect, it, vi } from 'vitest';
import { WebGpuEngine } from './WebGpuEngine';
import { DocumentEditingOverlayState } from './DocumentEditingOverlayState';

describe('WebGpuEngine presentation ownership', () => {
  it('drops document interaction projections at detach without touching canonical repositories', () => {
    const setSelectionVisible = vi.fn();
    const canonicalLayers = { release: vi.fn() };
    const canonicalPatterns = { release: vi.fn() };
    const canonicalLookups = { release: vi.fn() };
    const editingOverlays = new DocumentEditingOverlayState();
    editingOverlays.vectorSelection = { elements: ['old-layer'] as never[], paths: [], anchors: [], active: null };
    editingOverlays.vectorSelectionPreviewTransform = { a: 1, b: 0, c: 0, d: 1, tx: 12, ty: 9 };
    editingOverlays.selectionOperations = [{ id: 'old-selection' }] as never[];
    editingOverlays.selectionPreviewProjectionActive = true;
    editingOverlays.selectionPreviewTranslation = { x: 12, y: 9 };
    editingOverlays.selectionDraft = { kind: 'rectangle', points: [] };
    editingOverlays.selectionVisible = true;
    editingOverlays.selectionPaintVisible = true;
    editingOverlays.textOverlay = { resourceKey: 'old-text' } as never;
    editingOverlays.textCaretVisible = false;
    editingOverlays.zoomDraft = { kind: 'rectangle', points: [] };
    editingOverlays.brushCursor = { center: { x: 1, y: 1 }, diameter: 10 };
    editingOverlays.penRubberBand = { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
    editingOverlays.penOverlay = { resourceKey: 'old-pen' } as never;
    editingOverlays.faceWarpOverlay = { resourceKey: 'old-warp' } as never;
    editingOverlays.faceWarpMode = 'sculpt';
    editingOverlays.transformFrame = { bounds: {} } as never;
    editingOverlays.smartGuideFrame = { bounds: {} } as never;
    editingOverlays.documentGuideFrame = { bounds: {} } as never;
    editingOverlays.documentGridFrame = { bounds: {} } as never;
    const clearDocument = vi.fn();
    const engine = {
      paintInteractionActive: true,
      warpInteractionActive: true,
      pendingTextInteractionTrace: { inputId: 1 },
      editingOverlays,
      editingOverlayRenderer: { clearDocument },
      selectionAntsAnimator: { setSelectionVisible },
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
    expect(editingOverlays.vectorSelection).toEqual({
      elements: [], paths: [], anchors: [], active: null
    });
    expect(editingOverlays.vectorSelectionPreviewTransform).toBeNull();
    expect(editingOverlays.selectionOperations).toEqual([]);
    expect(editingOverlays.selectionPreviewProjectionActive).toBe(false);
    expect(editingOverlays.selectionPreviewTranslation).toEqual({ x: 0, y: 0 });
    expect(editingOverlays.selectionDraft).toBeNull();
    expect(editingOverlays.selectionVisible).toBe(false);
    expect(editingOverlays.selectionPaintVisible).toBe(false);
    expect(setSelectionVisible).toHaveBeenCalledWith(false);
    expect(clearDocument).toHaveBeenCalledOnce();
    expect(editingOverlays.textOverlay).toBeNull();
    expect(editingOverlays.textCaretVisible).toBe(true);
    expect(editingOverlays.zoomDraft).toBeNull();
    expect(editingOverlays.brushCursor).toBeNull();
    expect(editingOverlays.penRubberBand).toBeNull();
    expect(editingOverlays.penOverlay).toBeNull();
    expect(editingOverlays.faceWarpOverlay).toBeNull();
    expect(editingOverlays.faceWarpMode).toBeNull();
    expect(editingOverlays.transformFrame).toBeNull();
    expect(editingOverlays.smartGuideFrame).toBeNull();
    expect(editingOverlays.documentGuideFrame).toBeNull();
    expect(editingOverlays.documentGridFrame).toBeNull();
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
