import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react';
import type { Rect } from '../document/documentTypes';

interface ResizeViewportTransition {
  durationMs?: number;
  fromOffsetX?: number;
  fromOffsetY?: number;
}

export interface ResizeRendererPort {
  resizeScopes(): void;
  resizeViewport(
    width: number,
    height: number,
    pixelRatio: number,
    imageRect: Rect,
    transition?: ResizeViewportTransition
  ): void;
}

interface EditorResizeControllerOptions {
  open: boolean;
  active: boolean;
  documentSurfaceRevision: number;
  observersEnabled: boolean;
  hasMetadata: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  scopesColumnRef: RefObject<HTMLElement | null>;
  colorMixerScopeRef: RefObject<HTMLElement | null>;
  getRenderer: () => ResizeRendererPort | null;
  viewportSize: { width: number; height: number };
  setViewportSize: Dispatch<SetStateAction<{ width: number; height: number }>>;
  imageRect: Rect;
  viewportThrottleMs?: number;
  scopesSettleMs?: number;
}

export interface EditorResizeController {
  dockResizeActiveRef: RefObject<boolean>;
  handleDockResizeInteractionChange(active: boolean): void;
}

export const measureRoundedElementSize = (
  bounds: Pick<DOMRect, 'width' | 'height'>
) => ({
  width: Math.max(1, Math.round(bounds.width)),
  height: Math.max(1, Math.round(bounds.height))
});

/**
 * Serializes dock-resize and ResizeObserver work for one document surface.
 *
 * Dockview owns sash movement; this controller pauses editor observers during
 * that gesture and performs one viewport/scope measurement after layout
 * settles. That prevents competing proportional-layout and canvas-resize loops.
 */
export const useEditorResizeController = ({
  open,
  active,
  documentSurfaceRevision,
  observersEnabled,
  hasMetadata,
  viewportRef,
  canvasRef,
  scopesColumnRef,
  colorMixerScopeRef,
  getRenderer,
  viewportSize,
  setViewportSize,
  imageRect,
  viewportThrottleMs = 50,
  scopesSettleMs = 120
}: EditorResizeControllerOptions): EditorResizeController => {
  const dockResizeActiveRef = useRef(false);
  const dockResizeFinishFrameRef = useRef<number | null>(null);
  const canvasUnlockFrameRef = useRef<number | null>(null);
  const resizeStartBoundsRef = useRef<Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null>(null);
  const pendingTransitionRef = useRef<ResizeViewportTransition | null>(null);
  const getRendererRef = useRef(getRenderer);
  getRendererRef.current = getRenderer;

  useEffect(() => {
    if (!open || !viewportRef.current) return;
    const element = viewportRef.current;
    let pendingSize: { width: number; height: number } | null = null;
    let updateTimer: number | null = null;
    let updateFrame: number | null = null;
    let lastUpdateAt = 0;

    const readSize = () => {
      return measureRoundedElementSize(element.getBoundingClientRect());
    };
    const commitPendingSize = () => {
      updateFrame = null;
      if (dockResizeActiveRef.current) {
        pendingSize = null;
        return;
      }
      const next = pendingSize;
      pendingSize = null;
      if (!next) return;
      lastUpdateAt = performance.now();
      setViewportSize((current) => (
        current.width === next.width && current.height === next.height
          ? current
          : next
      ));
    };
    const scheduleSizeUpdate = () => {
      if (dockResizeActiveRef.current) return;
      pendingSize = readSize();
      if (updateTimer !== null || updateFrame !== null) return;
      const delay = Math.max(
        0,
        viewportThrottleMs - (performance.now() - lastUpdateAt)
      );
      updateTimer = window.setTimeout(() => {
        updateTimer = null;
        updateFrame = window.requestAnimationFrame(commitPendingSize);
      }, delay);
    };

    pendingSize = readSize();
    commitPendingSize();
    if (!observersEnabled) return;
    const observer = new ResizeObserver(scheduleSizeUpdate);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (updateTimer !== null) window.clearTimeout(updateTimer);
      if (updateFrame !== null) window.cancelAnimationFrame(updateFrame);
    };
  }, [
    active,
    documentSurfaceRevision,
    observersEnabled,
    open,
    setViewportSize,
    viewportRef,
    viewportThrottleMs
  ]);

  useEffect(() => {
    if (!open || !active) return;
    const elements = [scopesColumnRef, colorMixerScopeRef]
      .map((reference) => reference.current)
      .filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length) return;
    getRendererRef.current()?.resizeScopes();
    if (!observersEnabled) return;
    let resizeTimer: number | null = null;
    let resizeFrame: number | null = null;
    const resizeAfterLayoutSettles = () => {
      if (dockResizeActiveRef.current) return;
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          if (!dockResizeActiveRef.current) {
            getRendererRef.current()?.resizeScopes();
          }
        });
      }, scopesSettleMs);
    };
    const observer = new ResizeObserver(resizeAfterLayoutSettles);
    elements.forEach((element) => observer.observe(element));
    return () => {
      observer.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    };
  }, [
    active,
    documentSurfaceRevision,
    observersEnabled,
    open,
    scopesColumnRef,
    colorMixerScopeRef,
    scopesSettleMs
  ]);

  const handleDockResizeInteractionChange = useCallback((resizeActive: boolean) => {
    dockResizeActiveRef.current = resizeActive;
    if (dockResizeFinishFrameRef.current !== null) {
      window.cancelAnimationFrame(dockResizeFinishFrameRef.current);
      dockResizeFinishFrameRef.current = null;
    }
    if (resizeActive) {
      if (canvasUnlockFrameRef.current !== null) {
        window.cancelAnimationFrame(canvasUnlockFrameRef.current);
        canvasUnlockFrameRef.current = null;
      }
      const viewport = viewportRef.current;
      const canvas = canvasRef.current;
      if (viewport && canvas) {
        const bounds = viewport.getBoundingClientRect();
        resizeStartBoundsRef.current = bounds;
        // The backing store intentionally stays unchanged while Dockview moves
        // a sash. Freeze its CSS size as well, otherwise the browser stretches
        // that retained frame to every transient panel dimension.
        canvas.style.width = `${bounds.width}px`;
        canvas.style.height = `${bounds.height}px`;
        viewport.dataset.dockResizeActive = 'true';
      }
      return;
    }

    dockResizeFinishFrameRef.current = window.requestAnimationFrame(() => {
      dockResizeFinishFrameRef.current = null;
      const viewport = viewportRef.current;
      if (viewport) {
        const nextBounds = viewport.getBoundingClientRect();
        const { width, height } = measureRoundedElementSize(nextBounds);
        const startBounds = resizeStartBoundsRef.current;
        const changed = viewportSize.width !== width || viewportSize.height !== height;
        pendingTransitionRef.current = changed && startBounds ? {
          durationMs: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 220,
          fromOffsetX: startBounds.left - nextBounds.left,
          fromOffsetY: startBounds.top - nextBounds.top
        } : null;
        setViewportSize((current) => (
          current.width === width && current.height === height
            ? current
            : { width, height }
        ));
        if (!changed) releaseFrozenCanvasPresentation(viewport, canvasRef.current);
      }
      getRendererRef.current()?.resizeScopes();
    });
  }, [canvasRef, setViewportSize, viewportRef, viewportSize.height, viewportSize.width]);

  useEffect(() => () => {
    if (dockResizeFinishFrameRef.current !== null) {
      window.cancelAnimationFrame(dockResizeFinishFrameRef.current);
    }
    if (canvasUnlockFrameRef.current !== null) {
      window.cancelAnimationFrame(canvasUnlockFrameRef.current);
    }
    releaseFrozenCanvasPresentation(viewportRef.current, canvasRef.current);
  }, [canvasRef, viewportRef]);

  useEffect(() => {
    if (!hasMetadata) return;
    const transition = pendingTransitionRef.current ?? undefined;
    pendingTransitionRef.current = null;
    getRendererRef.current()?.resizeViewport(
      viewportSize.width,
      viewportSize.height,
      Math.max(1, window.devicePixelRatio || 1),
      imageRect,
      transition
    );
    if (canvasUnlockFrameRef.current !== null) {
      window.cancelAnimationFrame(canvasUnlockFrameRef.current);
    }
    canvasUnlockFrameRef.current = window.requestAnimationFrame(() => {
      canvasUnlockFrameRef.current = null;
      releaseFrozenCanvasPresentation(viewportRef.current, canvasRef.current);
      resizeStartBoundsRef.current = null;
    });
  }, [
    canvasRef,
    hasMetadata,
    imageRect,
    viewportRef,
    viewportSize.height,
    viewportSize.width
  ]);

  return { dockResizeActiveRef, handleDockResizeInteractionChange };
};

const releaseFrozenCanvasPresentation = (
  viewport: HTMLDivElement | null,
  canvas: HTMLCanvasElement | null
) => {
  canvas?.style.removeProperty('width');
  canvas?.style.removeProperty('height');
  if (viewport) delete viewport.dataset.dockResizeActive;
};
