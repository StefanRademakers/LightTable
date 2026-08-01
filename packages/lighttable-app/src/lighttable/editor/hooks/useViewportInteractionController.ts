import {
  useEffect,
  useRef,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent
} from 'react';
import { LatestFrameValueScheduler } from '../../application/input/latestFrameValueScheduler';
import type { PaintSessionController } from '../../application/tools/paint/usePaintSessionController';
import type { SelectionSessionController } from '../../application/tools/selection/useSelectionSessionController';
import type { WarpSessionController } from '../../application/tools/warp/warpSessionController';
import {
  resolveViewportPointerDownIntent,
  resolveViewportPointerEndIntent,
  resolveViewportPointerMoveIntent
} from '../../application/input/viewportPointerRouter';
import type { ImageDocument, Rect } from '../document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../document/layerTree';
import type { EditorSession } from '../session/editorSession';
import { paintTargetSourceToDocument } from '../tools/paint/paintCoordinates';
import {
  isPaintTool,
  isSelectionTool,
  isWarpTool
} from '../tools/toolCapabilities';
import type { TemporaryToolController } from '../tools/temporaryToolController';
import {
  clientToLocalPoint,
  localToDocumentPointer,
  panViewFromGesture,
  pointInsideRect,
  zoomViewAtPoint,
  zoomViewToScaleAtPoint
} from '../tools/pointer/viewportCoordinates';
import {
  steppedZoomPercent,
  zoomPercentToScale
} from '../tools/zoom/zoomLevels';
import type { LightTableImageMetadata, LightTableViewState } from '../../types';
import type { VectorToolSessionController } from '../../application/vectors/VectorToolSessionController';
import { isVectorEditorTool } from '../tools/vectorToolCatalog';

interface ViewportSize {
  width: number;
  height: number;
}

interface ViewportBounds {
  readonly left: number;
  readonly top: number;
}

interface ViewportInteractionOptions {
  metadata: LightTableImageMetadata | null;
  document: ImageDocument | null;
  imageRect: Rect;
  activeScale: number;
  viewportSize: ViewportSize;
  view: LightTableViewState;
  setView: Dispatch<SetStateAction<LightTableViewState>>;
  setZoomMode: (mode: 'fit' | '100' | 'custom') => void;
  editorSession: EditorSession;
  setEditorSession: Dispatch<SetStateAction<EditorSession>>;
  temporaryTools: TemporaryToolController;
  focusPickerActive: boolean;
  onFocusPick: (normalizedPoint: { x: number; y: number }) => void;
  onFocusPickerEnd: () => void;
  onFill: (color: string) => void;
  selection: SelectionSessionController;
  paint: PaintSessionController;
  warp: WarpSessionController;
  vector: VectorToolSessionController;
  minScale: number;
  maxScale: number;
}

export interface ViewportInteractionController {
  brushCursorRef: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  onWheel(event: WheelEvent<HTMLDivElement>): void;
  onPointerDown(event: PointerEvent<HTMLDivElement>): void;
  onPointerMove(event: PointerEvent<HTMLDivElement>): void;
  onPointerUp(event: PointerEvent<HTMLDivElement>): void;
  onPointerCancel(event: PointerEvent<HTMLDivElement>): void;
  hideBrushCursor(): void;
}

/**
 * Owns viewport gesture routing and coordinate projection.
 *
 * The controller never mutates document pixels itself. Selection, paint, fill
 * and focus picking are explicit ports, so document/GPU transaction ownership
 * remains in their feature controllers and each mounted document gets an
 * isolated gesture state.
 */
export const useViewportInteractionController = ({
  metadata,
  document,
  imageRect,
  activeScale,
  viewportSize,
  view,
  setView,
  setZoomMode,
  editorSession,
  setEditorSession,
  temporaryTools,
  focusPickerActive,
  onFocusPick,
  onFocusPickerEnd,
  onFill,
  selection,
  paint,
  warp,
  vector,
  minScale,
  maxScale
}: ViewportInteractionOptions): ViewportInteractionController => {
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  const brushCursorCenterRef = useRef<{ x: number; y: number } | null>(null);
  const setViewRef = useRef(setView);
  setViewRef.current = setView;
  const panFrameRef = useRef<LatestFrameValueScheduler<{
    panX: number;
    panY: number;
  }> | null>(null);
  const zoomFrameRef = useRef<LatestFrameValueScheduler<LightTableViewState> | null>(null);
  if (!panFrameRef.current) {
    panFrameRef.current = new LatestFrameValueScheduler((pan) => {
      setViewRef.current((current) => ({ ...current, ...pan }));
    });
  }
  if (!zoomFrameRef.current) {
    zoomFrameRef.current = new LatestFrameValueScheduler((nextView) => {
      setViewRef.current(nextView);
    });
  }

  useEffect(() => {
    // A workspace tab can replace the document-owned setter without
    // unmounting this hook. Never let queued viewport input cross that boundary.
    panFrameRef.current?.cancel();
    zoomFrameRef.current?.cancel();
  }, [setView]);

  useEffect(() => () => {
    panFrameRef.current?.dispose();
    panFrameRef.current = null;
    zoomFrameRef.current?.dispose();
    zoomFrameRef.current = null;
  }, []);

  useEffect(() => {
    const cursor = brushCursorRef.current;
    const center = brushCursorCenterRef.current;
    if (!cursor || !center) return;
    const diameterPx = isWarpTool(editorSession.activeTool)
      ? editorSession.warp.diameterPx
      : editorSession.brush.size;
    const diameter = Math.max(2, diameterPx * activeScale);
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform =
      `translate3d(${center.x - diameter / 2}px, ${center.y - diameter / 2}px, 0)`;
  }, [activeScale, editorSession.activeTool, editorSession.brush.size, editorSession.warp.diameterPx]);

  const documentPoint = (
    event: PointerEvent<HTMLDivElement>,
    bounds: ViewportBounds = event.currentTarget.getBoundingClientRect()
  ) => {
    if (!metadata) return null;
    const point = localToDocumentPointer(
      clientToLocalPoint(
        { x: event.clientX, y: event.clientY },
        { x: bounds.left, y: bounds.top }
      ),
      imageRect,
      activeScale,
      metadata,
      event.pressure
    );
    if (
      !point
      || !editorSession.selectionPixelSnap
      || !isSelectionTool(editorSession.activeTool)
      || editorSession.activeTool === 'select-free'
      || editorSession.activeTool === 'select-polygonal'
    ) return point;
    return {
      ...point,
      x: Math.round(point.x),
      y: Math.round(point.y)
    };
  };

  const hideBrushCursor = () => {
    brushCursorCenterRef.current = null;
    if (brushCursorRef.current) brushCursorRef.current.style.opacity = '0';
  };

  const updateBrushCursor = (
    event: PointerEvent<HTMLDivElement>,
    bounds: ViewportBounds = event.currentTarget.getBoundingClientRect()
  ) => {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    if (
      (!isPaintTool(editorSession.activeTool) && !isWarpTool(editorSession.activeTool))
      || temporaryTools.active
      || focusPickerActive
      || !metadata
    ) {
      hideBrushCursor();
      return;
    }
    const point = clientToLocalPoint(
      { x: event.clientX, y: event.clientY },
      { x: bounds.left, y: bounds.top }
    );
    if (!pointInsideRect(point, imageRect)) {
      hideBrushCursor();
      return;
    }
    const diameterPx = isWarpTool(editorSession.activeTool)
      ? editorSession.warp.diameterPx
      : editorSession.brush.size;
    const diameter = Math.max(2, diameterPx * activeScale);
    brushCursorCenterRef.current = point;
    cursor.style.opacity = '1';
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform =
      `translate3d(${point.x - diameter / 2}px, ${point.y - diameter / 2}px, 0)`;
  };

  const beginPan = (event: PointerEvent<HTMLDivElement>, forcePan = false) => {
    if (event.button !== 0 || !metadata) return;
    if (!forcePan && focusPickerActive) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = {
        x: (event.clientX - bounds.left - imageRect.x) / Math.max(imageRect.width, 1),
        y: (event.clientY - bounds.top - imageRect.y) / Math.max(imageRect.height, 1)
      };
      if (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) {
        onFocusPick(point);
      }
      onFocusPickerEnd();
      event.preventDefault();
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: view.panX,
      panY: view.panY
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const pan = panViewFromGesture({
      origin: { x: drag.x, y: drag.y },
      current: { x: event.clientX, y: event.clientY },
      initialView: { panX: drag.panX, panY: drag.panY }
    });
    panFrameRef.current?.schedule(pan);
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    // Pointer-up can arrive before the scheduled display frame. Commit the
    // newest coordinates so persisted per-document viewport state is exact.
    panFrameRef.current?.flush();
    dragRef.current = null;
  };

  return {
    brushCursorRef,
    dragging: Boolean(dragRef.current),
    hideBrushCursor,
    onWheel: (event) => {
      if (!metadata) return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const cursor = clientToLocalPoint(
        { x: event.clientX, y: event.clientY },
        { x: bounds.left, y: bounds.top }
      );
      setZoomMode('custom');
      const pendingView = zoomFrameRef.current?.pending();
      const nextView = zoomViewAtPoint({
        cursor,
        viewport: viewportSize,
        view: pendingView ?? { scale: activeScale, panX: view.panX, panY: view.panY },
        wheelDelta: event.deltaY,
        minScale,
        maxScale
      });
      zoomFrameRef.current?.schedule(nextView);
    },
    onPointerDown: (event) => {
      // A bounding-client-rect read may force layout. Snapshot it once for all
      // pointer-down routing instead of asking the cursor and document
      // projection paths to perform separate synchronous reads.
      const bounds = event.currentTarget.getBoundingClientRect();
      updateBrushCursor(event, bounds);
      if (
        editorSession.activeTool === 'zoom'
        && !temporaryTools.active
        && event.button === 0
        && metadata
      ) {
        const cursor = clientToLocalPoint(
          { x: event.clientX, y: event.clientY },
          { x: bounds.left, y: bounds.top }
        );
        const nextPercent = steppedZoomPercent(
          activeScale * 100,
          event.altKey ? -1 : 1
        );
        setZoomMode('custom');
        setView(zoomViewToScaleAtPoint({
          cursor,
          viewport: viewportSize,
          view: { scale: activeScale, panX: view.panX, panY: view.panY },
          scale: zoomPercentToScale(nextPercent)
        }));
        event.preventDefault();
        return;
      }
      const point = documentPoint(event, bounds);
      const activeTool = editorSession.activeTool;
      if (
        isVectorEditorTool(activeTool)
        && point
        && event.button === 0
        && !temporaryTools.active
      ) {
        if (vector.pointerDown(event.pointerId, point, {
          hitRadius: 7 / Math.max(activeScale, 0.0001),
          closeTolerance: 8 / Math.max(activeScale, 0.0001),
          additive: event.shiftKey,
          preserveAspect: event.shiftKey
        })) {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }
      const paintTarget = document
        ? editorSession.activeChannel === 'mask'
          ? findDocumentLayer(document, document.activeLayerId)
          : findRasterLayer(document, document.activeLayerId)
        : null;
      const intent = resolveViewportPointerDownIntent({
        activeTool,
        temporaryPan: temporaryTools.active,
        focusPickerActive,
        primaryButton: event.button === 0,
        hasMetadata: Boolean(metadata),
        hasDocument: Boolean(document),
        hasDocumentPoint: Boolean(point),
        hasPaintTarget: Boolean(paintTarget),
        hasWarpTarget: Boolean(
          document && findRasterLayer(document, document.activeLayerId)
        )
      });

      if (intent === 'temporary-pan') {
        beginPan(event, true);
        event.preventDefault();
        return;
      }
      if (
        intent === 'selection'
        && point
        && activeTool === 'select-polygonal'
      ) {
        if (selection.polygonClick(
          point,
          8 / Math.max(activeScale, 0.0001),
          { shiftKey: event.shiftKey, altKey: event.altKey },
          event.detail >= 2,
          event.timeStamp
        )) {
          event.preventDefault();
        }
        return;
      }
      if (intent === 'selection' && point && isSelectionTool(activeTool)) {
        if (selection.begin(event.pointerId, activeTool, point)) {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }
      if (intent === 'fill') {
        onFill(editorSession.brush.color);
        event.preventDefault();
        return;
      }
      if (intent === 'warp' && point) {
        const started = warp.begin({
          pointerId: event.pointerId,
          mode: editorSession.warp.mode,
          settings: {
            diameterPx: editorSession.warp.diameterPx,
            strength: editorSession.warp.strength,
            hardness: editorSession.warp.hardness,
            flow: editorSession.warp.flow,
            spacing: editorSession.warp.spacing,
            pressureSize: editorSession.warp.pressureSize,
            pressureStrength: editorSession.warp.pressureStrength
          },
          point: {
            ...point,
            tiltX: event.tiltX,
            tiltY: event.tiltY,
            timeMs: event.timeStamp
          }
        });
        if (started) {
          setEditorSession((current) => ({ ...current, pointerId: event.pointerId }));
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }
      if (intent === 'view') {
        beginPan(event);
        return;
      }
      if (intent !== 'paint' || !point || !paintTarget) return;
      const started = paint.begin({
        pointerId: event.pointerId,
        layer: paintTarget,
        target: {
          layerId: paintTarget.id,
          channel: editorSession.activeChannel,
          erase: activeTool === 'erase',
          sourceToDocument: paintTargetSourceToDocument(
            paintTarget,
            editorSession.activeChannel
          )
        },
        brush: editorSession.brush,
        point
      });
      if (started) {
        setEditorSession((current) => ({ ...current, pointerId: event.pointerId }));
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    },
    onPointerMove: (event) => {
      // Pointer devices can deliver substantially more than one event per
      // display frame. Keep this hot path to one layout-dependent read.
      const bounds = event.currentTarget.getBoundingClientRect();
      updateBrushCursor(event, bounds);
      const point = documentPoint(event, bounds);
      if (point && vector.ownsPointer(event.pointerId)) {
        if (vector.pointerMove(event.pointerId, point)) event.preventDefault();
        return;
      }
      if (
        editorSession.activeTool === 'select-polygonal'
        && selection.polygonActive
        && point
      ) {
        if (selection.polygonMove(point)) event.preventDefault();
        return;
      }
      const intent = resolveViewportPointerMoveIntent({
        activeTool: editorSession.activeTool,
        temporaryPan: temporaryTools.active,
        panGestureMatches: dragRef.current?.pointerId === event.pointerId,
        selectionGestureMatches: selection.owns(event.pointerId),
        warpGestureMatches: warp.owns(event.pointerId),
        paintGestureMatches: paint.owns(event.pointerId),
        hasDocumentPoint: Boolean(point),
        hasPaintTarget: paint.active,
        hasStrokeBuilder: paint.active
      });
      if (intent === 'pan') {
        movePan(event);
        return;
      }
      if (intent === 'selection' && point) {
        if (selection.move(event.pointerId, point)) event.preventDefault();
        return;
      }
      if (
        intent === 'warp'
        && point
        && warp.move(event.pointerId, {
          ...point,
          tiltX: event.tiltX,
          tiltY: event.tiltY,
          timeMs: event.timeStamp
        })
      ) {
        event.preventDefault();
        return;
      }
      if (intent === 'paint' && point && paint.move(event.pointerId, point)) {
        event.preventDefault();
      }
    },
    onPointerUp: (event) => {
      if (vector.ownsPointer(event.pointerId)) {
        const point = documentPoint(event);
        if (point) vector.pointerUp(event.pointerId, point, event.detail);
        else vector.pointerCancel(event.pointerId);
        event.preventDefault();
        return;
      }
      const intent = resolveViewportPointerEndIntent({
        selectionGestureMatches: selection.owns(event.pointerId),
        warpGestureMatches: warp.owns(event.pointerId),
        paintGestureMatches: paint.owns(event.pointerId)
      });
      if (intent === 'selection') {
        selection.finish(event.pointerId, {
          shiftKey: event.shiftKey,
          altKey: event.altKey
        });
        event.preventDefault();
        return;
      }
      if (intent === 'paint') {
        paint.finish(event.pointerId);
        setEditorSession((current) => ({ ...current, pointerId: null }));
      }
      if (intent === 'warp') {
        warp.finish(event.pointerId, event.timeStamp);
        setEditorSession((current) => ({ ...current, pointerId: null }));
        event.preventDefault();
        return;
      }
      endPan(event);
    },
    onPointerCancel: (event) => {
      vector.pointerCancel(event.pointerId);
      selection.cancel(event.pointerId);
      warp.cancel(event.pointerId);
      paint.cancel(event.pointerId);
      setEditorSession((current) => ({ ...current, pointerId: null }));
      endPan(event);
    }
  };
};
