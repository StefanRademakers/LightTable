import {
  useEffect,
  useRef,
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
  type WheelEvent
} from 'react';
import { LatestFrameValueScheduler } from '../../application/input/latestFrameValueScheduler';
import { PointerClickCounter } from '../../application/input/pointerClickCounter';
import type { PaintSessionController } from '../../application/tools/paint/usePaintSessionController';
import type { SelectionSessionController } from '../../application/tools/selection/useSelectionSessionController';
import type { WarpSessionController } from '../../application/tools/warp/warpSessionController';
import {
  capturedGestureUsesUnboundedDocumentPoint,
  resolveViewportPointerDownIntent,
  resolveViewportPointerEndIntent,
  resolveViewportPointerMoveIntent
} from '../../application/input/viewportPointerRouter';
import type { ImageDocument, Rect } from '../document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../document/layerTree';
import type { EditorSession } from '../session/editorSession';
import {
  resolveSelectionCombineMode,
  type SelectionShape
} from '../selection/selectionTypes';
import { paintTargetSourceToDocument } from '../tools/paint/paintCoordinates';
import type { BrushPoint } from '../tools/brush/strokeBuilder';
import {
  isPaintTool,
  isSelectionTool,
  isWarpTool
} from '../tools/toolCapabilities';
import type { TemporaryToolController } from '../tools/temporaryToolController';
import {
  clientToLocalPoint,
  localToDocumentPointer,
  panViewFromWheel,
  panViewFromGesture,
  pointInsideRect,
  resolveWheelPanDeltas,
  zoomViewAtPoint,
  zoomViewToScaleAtPoint,
  zoomViewToViewportRect
} from '../tools/pointer/viewportCoordinates';
import {
  steppedZoomPercent,
  zoomPercentToScale
} from '../tools/zoom/zoomLevels';
import type { LightTableImageMetadata, LightTableViewState } from '../../types';
import type { VectorToolSessionController } from '../../application/vectors/VectorToolSessionController';
import type { RasterGradientCommandController } from '../../application/tools/gradient/RasterGradientCommandController';
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
  temporaryZoomOut: boolean;
  vectorMoveActive: boolean;
  preciseBrushCursor: boolean;
  eyedropperActive: boolean;
  onColorPick: (point: { x: number; y: number }) => void;
  focusPickerActive: boolean;
  onFocusPick: (normalizedPoint: { x: number; y: number }) => void;
  onFocusPickerEnd: () => void;
  onFill: (color: string, preserveTransparency?: boolean) => void;
  onPointTextCreate: (
    point: { x: number; y: number },
    clickCount: number,
    extend: boolean
  ) => void;
  textGesture: {
    beginPoint(
      pointerId: number,
      point: { x: number; y: number },
      temporaryMove: boolean,
      clickCount: number,
      extend: boolean
    ): boolean;
    beginParagraph(
      pointerId: number,
      point: { x: number; y: number },
      temporaryMove: boolean,
      clickCount: number,
      extend: boolean
    ): boolean;
    owns(pointerId: number): boolean;
    move(pointerId: number, point: { x: number; y: number }): boolean;
    finish(pointerId: number, point: { x: number; y: number }): boolean;
    cancel(pointerId: number): boolean;
  };
  selection: SelectionSessionController;
  paint: PaintSessionController;
  warp: WarpSessionController;
  vector: VectorToolSessionController;
  rasterGradient: RasterGradientCommandController;
  minScale: number;
  maxScale: number;
  zoomWithScrollWheel: boolean;
  onBrushCursorChange: (cursor: {
    center: { x: number; y: number };
    diameter: number;
  } | null) => void;
  onZoomDraftChange: (draft: SelectionShape | null) => void;
  onPenRubberBandChange: (band: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null) => void;
}

export interface ViewportInteractionController {
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
  temporaryZoomOut,
  vectorMoveActive,
  preciseBrushCursor,
  eyedropperActive,
  onColorPick,
  focusPickerActive,
  onFocusPick,
  onFocusPickerEnd,
  onFill,
  onPointTextCreate,
  textGesture,
  selection,
  paint,
  warp,
  vector,
  rasterGradient,
  minScale,
  maxScale,
  zoomWithScrollWheel,
  onBrushCursorChange,
  onZoomDraftChange,
  onPenRubberBandChange
}: ViewportInteractionOptions): ViewportInteractionController => {
  const effectiveTool = temporaryTools.effectiveTool(editorSession.activeTool);
  const temporaryPan = temporaryTools.activeTool === 'view';
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const zoomDragRef = useRef<{
    pointerId: number;
    startLocal: { x: number; y: number };
    currentLocal: { x: number; y: number };
    startDocument: { x: number; y: number };
    currentDocument: { x: number; y: number };
    zoomOut: boolean;
  } | null>(null);
  const brushCursorCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastBrushPointRef = useRef<BrushPoint | null>(null);
  const textClickCounterRef = useRef<PointerClickCounter | null>(null);
  textClickCounterRef.current ??= new PointerClickCounter();
  const setViewRef = useRef(setView);
  setViewRef.current = setView;
  const onBrushCursorChangeRef = useRef(onBrushCursorChange);
  onBrushCursorChangeRef.current = onBrushCursorChange;
  const onZoomDraftChangeRef = useRef(onZoomDraftChange);
  onZoomDraftChangeRef.current = onZoomDraftChange;
  const onPenRubberBandChangeRef = useRef(onPenRubberBandChange);
  onPenRubberBandChangeRef.current = onPenRubberBandChange;
  const onColorPickRef = useRef(onColorPick);
  onColorPickRef.current = onColorPick;
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

  useEffect(() => {
    textClickCounterRef.current?.reset();
  }, [document?.id, editorSession.activeTool]);

  useEffect(() => () => {
    panFrameRef.current?.dispose();
    panFrameRef.current = null;
    zoomFrameRef.current?.dispose();
    zoomFrameRef.current = null;
  }, []);

  useEffect(() => {
    const center = brushCursorCenterRef.current;
    if (!center) return;
    if (!isPaintTool(effectiveTool) && !isWarpTool(effectiveTool)) {
      brushCursorCenterRef.current = null;
      onBrushCursorChangeRef.current(null);
      return;
    }
    const diameterPx = isWarpTool(effectiveTool)
      ? editorSession.warp.diameterPx
      : editorSession.brush.size;
    onBrushCursorChangeRef.current({ center, diameter: diameterPx });
  }, [effectiveTool, editorSession.brush.size, editorSession.warp.diameterPx]);

  useEffect(() => () => {
    onBrushCursorChangeRef.current(null);
    onZoomDraftChangeRef.current(null);
  }, []);

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
      event.pressure,
      capturedGestureUsesUnboundedDocumentPoint({
        selectionGestureMatches: selection.owns(event.pointerId),
        warpGestureMatches: warp.owns(event.pointerId),
        paintGestureMatches: paint.owns(event.pointerId)
      }) || isSelectionTool(editorSession.activeTool)
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
    onBrushCursorChangeRef.current(null);
    onPenRubberBandChangeRef.current(null);
  };

  const updateBrushCursor = (
    event: PointerEvent<HTMLDivElement>,
    bounds: ViewportBounds = event.currentTarget.getBoundingClientRect()
  ) => {
    if (
      (!isPaintTool(effectiveTool) && !isWarpTool(effectiveTool))
      || temporaryPan
      || focusPickerActive
      || preciseBrushCursor
      || eyedropperActive
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
    const diameterPx = isWarpTool(effectiveTool)
      ? editorSession.warp.diameterPx
      : editorSession.brush.size;
    const center = {
      x: (point.x - imageRect.x) / Math.max(activeScale, 1e-6),
      y: (point.y - imageRect.y) / Math.max(activeScale, 1e-6)
    };
    brushCursorCenterRef.current = center;
    onBrushCursorChangeRef.current({ center, diameter: diameterPx });
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
    dragging: Boolean(dragRef.current),
    hideBrushCursor,
    onWheel: (event) => {
      if (!metadata) return;
      event.preventDefault();
      if (!zoomWithScrollWheel && !event.ctrlKey && !event.metaKey) {
        const deltaMultiplier = event.deltaMode === 1
          ? 16
          : event.deltaMode === 2 ? viewportSize.height : 1;
        const pendingPan = panFrameRef.current?.pending();
        const basePan = pendingPan ?? { panX: view.panX, panY: view.panY };
        const nativeWheel = event.nativeEvent as globalThis.WheelEvent & {
          readonly wheelDeltaX?: number;
        };
        const wheelDelta = resolveWheelPanDeltas({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          legacyWheelDeltaX: nativeWheel.wheelDeltaX,
          shiftKey: event.shiftKey
        });
        panFrameRef.current?.schedule(panViewFromWheel({
          initialView: basePan,
          deltaX: wheelDelta.deltaX,
          deltaY: wheelDelta.deltaY,
          deltaMultiplier
        }));
        return;
      }
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
        effectiveTool === 'zoom'
        && !temporaryPan
        && event.button === 0
        && metadata
      ) {
        const cursor = clientToLocalPoint(
          { x: event.clientX, y: event.clientY },
          { x: bounds.left, y: bounds.top }
        );
        const point = localToDocumentPointer(
          cursor,
          imageRect,
          activeScale,
          metadata,
          event.pressure,
          false
        );
        if (!point) return;
        zoomDragRef.current = {
          pointerId: event.pointerId,
          startLocal: cursor,
          currentLocal: cursor,
          startDocument: point,
          currentDocument: point,
          zoomOut: temporaryZoomOut || event.altKey
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
      const point = documentPoint(event, bounds);
      if (eyedropperActive && point && event.button === 0) {
        onColorPickRef.current(point);
        event.preventDefault();
        return;
      }
      const activeTool = vectorMoveActive && effectiveTool === 'transform'
        ? 'vector-select'
        : effectiveTool;
      if (
        activeTool === 'gradient'
        && editorSession.gradient.application === 'pixels'
        && point
        && event.button === 0
        && !temporaryPan
      ) {
        if (rasterGradient.begin(event.pointerId, point)) {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }
      if (
        isVectorEditorTool(activeTool)
        && point
        && event.button === 0
        && !temporaryPan
      ) {
        if (vector.pointerDown(event.pointerId, point, {
          // A 24 px target remains comfortably usable with a mouse or trackpad
          // while staying below the 30 px upper limit for dense vector paths.
          hitRadius: 12 / Math.max(activeScale, 0.0001),
          closeTolerance: 8 / Math.max(activeScale, 0.0001),
          additive: event.shiftKey,
          autoAddDelete: editorSession.pen.autoAddDelete,
          temporaryDirect: event.ctrlKey || event.metaKey,
          temporaryConvert: event.altKey,
          preserveAspect: event.shiftKey,
          fromCenter: event.altKey || editorSession.shape.fromCenter,
          fixedSize: editorSession.shape.geometry === 'fixed'
            ? { x: editorSession.shape.width, y: editorSession.shape.height }
            : undefined,
          proportionalRatio: editorSession.shape.geometry === 'proportional'
            ? editorSession.shape.width / Math.max(editorSession.shape.height, 1e-6)
            : undefined,
          snapToPixels: editorSession.shape.snapToPixels,
          rasterize: activeTool.startsWith('shape-') && editorSession.shape.mode === 'pixels'
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
        temporaryPan,
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
        const selectionCombineMode = resolveSelectionCombineMode(
          editorSession.selectionCombineMode,
          event.shiftKey,
          event.altKey
        );
        if (selection.polygonClick(
          point,
          8 / Math.max(activeScale, 0.0001),
          selectionCombineMode,
          event.detail >= 2,
          event.timeStamp
        )) {
          event.preventDefault();
        }
        return;
      }
      if (intent === 'selection' && point && isSelectionTool(activeTool)) {
        const selectionCombineMode = resolveSelectionCombineMode(
          editorSession.selectionCombineMode,
          event.shiftKey,
          event.altKey
        );
        const stripSize = activeTool === 'select-horizontal'
          ? editorSession.selectionRowHeight
          : activeTool === 'select-vertical'
            ? editorSession.selectionColumnWidth
            : undefined;
        if (selection.begin(
          event.pointerId,
          activeTool,
          point,
          selectionCombineMode,
          stripSize
        )) {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }
      if (intent === 'fill') {
        onFill(editorSession.brush.color, event.shiftKey);
        event.preventDefault();
        return;
      }
      if (intent === 'text-create' && point) {
        const clickCount = textClickCounterRef.current!.next({
          x: event.clientX,
          y: event.clientY,
          timeMs: event.timeStamp,
          button: event.button,
          pointerType: event.pointerType
        });
        if (activeTool === 'text-point' || activeTool === 'text-paragraph'
          || activeTool === 'text-vertical') {
          if (textGesture.beginParagraph(
            event.pointerId,
            point,
            event.ctrlKey || event.metaKey,
            clickCount,
            event.shiftKey
          )) {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          event.preventDefault();
          return;
        }
        if (activeTool === 'text-path') {
          if (textGesture.beginPoint(
            event.pointerId,
            point,
            event.ctrlKey || event.metaKey,
            clickCount,
            event.shiftKey
          )) {
            event.currentTarget.setPointerCapture(event.pointerId);
          } else {
            onPointTextCreate({ x: point.x, y: point.y }, clickCount, event.shiftKey);
          }
          event.preventDefault();
          return;
        }
        if (textGesture.beginPoint(
          event.pointerId,
          point,
          event.ctrlKey || event.metaKey,
          clickCount,
          event.shiftKey
        )) {
          event.currentTarget.setPointerCapture(event.pointerId);
        } else {
          onPointTextCreate({ x: point.x, y: point.y }, clickCount, event.shiftKey);
        }
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
      const paintPoint = activeTool === 'brush' && event.shiftKey && lastBrushPointRef.current
        ? lastBrushPointRef.current
        : point;
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
        point: paintPoint
      });
      if (started) {
        if (paintPoint !== point) paint.move(event.pointerId, point);
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
      const zoomDrag = zoomDragRef.current;
      if (zoomDrag?.pointerId === event.pointerId && metadata) {
        const local = clientToLocalPoint(
          { x: event.clientX, y: event.clientY },
          { x: bounds.left, y: bounds.top }
        );
        const point = localToDocumentPointer(
          local, imageRect, activeScale, metadata, event.pressure, true
        );
        if (point) {
          zoomDrag.currentLocal = local;
          zoomDrag.currentDocument = point;
          if (!zoomDrag.zoomOut) {
            onZoomDraftChangeRef.current({
              kind: 'rectangle',
              points: [zoomDrag.startDocument, zoomDrag.currentDocument]
            });
          }
        }
        event.preventDefault();
        return;
      }
      const point = documentPoint(event, bounds);
      if (textGesture.owns(event.pointerId)) {
        textClickCounterRef.current?.moved(event.clientX, event.clientY);
        if (point && textGesture.move(event.pointerId, point)) event.preventDefault();
        return;
      }
      if (point && rasterGradient.owns(event.pointerId)) {
        if (rasterGradient.move(event.pointerId, point)) event.preventDefault();
        return;
      }
      if (point && vector.ownsPointer(event.pointerId)) {
        onPenRubberBandChangeRef.current(null);
        if (vector.pointerMove(event.pointerId, point, {
          preserveAspect: event.shiftKey,
          fromCenter: event.altKey || editorSession.shape.fromCenter,
          fixedSize: editorSession.shape.geometry === 'fixed'
            ? { x: editorSession.shape.width, y: editorSession.shape.height }
            : undefined,
          proportionalRatio: editorSession.shape.geometry === 'proportional'
            ? editorSession.shape.width / Math.max(editorSession.shape.height, 1e-6)
            : undefined,
          snapToPixels: editorSession.shape.snapToPixels,
          rasterize: (temporaryTools.activeTool ?? editorSession.activeTool).startsWith('shape-')
            && editorSession.shape.mode === 'pixels',
          moveOrigin: temporaryTools.activeTool === 'view'
        })) event.preventDefault();
        return;
      }
      if (effectiveTool === 'vector-pen') {
        onPenRubberBandChangeRef.current(
          point && editorSession.pen.rubberBand ? vector.penRubberBand(point) : null
        );
      } else {
        onPenRubberBandChangeRef.current(null);
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
        activeTool: effectiveTool,
        temporaryPan,
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
      const zoomDrag = zoomDragRef.current;
      if (zoomDrag?.pointerId === event.pointerId) {
        zoomDragRef.current = null;
        onZoomDraftChangeRef.current(null);
        const width = Math.abs(zoomDrag.currentLocal.x - zoomDrag.startLocal.x);
        const height = Math.abs(zoomDrag.currentLocal.y - zoomDrag.startLocal.y);
        setZoomMode('custom');
        if (zoomDrag.zoomOut || Math.hypot(width, height) < 5) {
          const nextPercent = steppedZoomPercent(
            activeScale * 100,
            zoomDrag.zoomOut ? -1 : 1
          );
          setView(zoomViewToScaleAtPoint({
            cursor: zoomDrag.startLocal,
            viewport: viewportSize,
            view: { scale: activeScale, panX: view.panX, panY: view.panY },
            scale: zoomPercentToScale(nextPercent)
          }));
        } else {
          setView(zoomViewToViewportRect({
            rect: {
              x: Math.min(zoomDrag.startLocal.x, zoomDrag.currentLocal.x),
              y: Math.min(zoomDrag.startLocal.y, zoomDrag.currentLocal.y),
              width,
              height
            },
            viewport: viewportSize,
            view: { scale: activeScale, panX: view.panX, panY: view.panY },
            minScale,
            maxScale
          }));
        }
        event.preventDefault();
        return;
      }
      if (textGesture.owns(event.pointerId)) {
        const point = documentPoint(event);
        if (point) textGesture.finish(event.pointerId, point);
        else textGesture.cancel(event.pointerId);
        event.preventDefault();
        return;
      }
      if (rasterGradient.owns(event.pointerId)) {
        const point = documentPoint(event);
        if (point) rasterGradient.finish(event.pointerId, point, event.shiftKey);
        else rasterGradient.cancel(event.pointerId);
        event.preventDefault();
        return;
      }
      if (vector.ownsPointer(event.pointerId)) {
        const point = documentPoint(event);
        if (point) vector.pointerUp(event.pointerId, point, event.detail, {
          preserveAspect: event.shiftKey,
          fromCenter: event.altKey || editorSession.shape.fromCenter,
          fixedSize: editorSession.shape.geometry === 'fixed'
            ? { x: editorSession.shape.width, y: editorSession.shape.height }
            : undefined,
          proportionalRatio: editorSession.shape.geometry === 'proportional'
            ? editorSession.shape.width / Math.max(editorSession.shape.height, 1e-6)
            : undefined,
          snapToPixels: editorSession.shape.snapToPixels,
          rasterize: (temporaryTools.activeTool ?? editorSession.activeTool).startsWith('shape-')
            && editorSession.shape.mode === 'pixels',
          moveOrigin: temporaryTools.activeTool === 'view'
        });
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
        selection.finish(event.pointerId);
        event.preventDefault();
        return;
      }
      if (intent === 'paint') {
        paint.finish(event.pointerId);
        const point = documentPoint(event);
        if (point && editorSession.activeTool === 'brush') lastBrushPointRef.current = point;
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
      if (zoomDragRef.current?.pointerId === event.pointerId) {
        zoomDragRef.current = null;
        onZoomDraftChangeRef.current(null);
        return;
      }
      if (textGesture.owns(event.pointerId)) {
        textGesture.cancel(event.pointerId);
        return;
      }
      rasterGradient.cancel(event.pointerId);
      vector.pointerCancel(event.pointerId);
      selection.cancel(event.pointerId);
      warp.cancel(event.pointerId);
      paint.cancel(event.pointerId);
      setEditorSession((current) => ({ ...current, pointerId: null }));
      endPan(event);
    }
  };
};
