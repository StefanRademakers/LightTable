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
import { coalescedPointerSamples } from '../../application/input/coalescedPointerSamples';
import type { PaintSessionController } from '../../application/tools/paint/usePaintSessionController';
import {
  isSampledBrushTool,
  type SampledBrushSourceController
} from '../../application/tools/paint/sampledBrush';
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
import {
  calibratedToneExposure,
  isToneBrushTool,
  type ToneBrushStrokePlan
} from '../tools/paint/toneBrushTypes';
import type { BrushPoint } from '../tools/brush/strokeBuilder';
import { resolveBrushPreset } from '../tools/brush/brushPresets';
import {
  isPaintTool,
  isSelectionTool,
  isWarpTool
} from '../tools/toolCapabilities';
import type { TemporaryToolController } from '../tools/temporaryToolController';
import type { VectorEditingOverlay } from '@lighttable/vector-rendering';
import {
  clientToLocalPoint,
  localToDocumentPointer,
  normalizePointerPressure,
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
import { routeFreehandPointerMove } from './routeFreehandPointerMove';

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
  onTransformPick: (point: { x: number; y: number }, extend: boolean) => void;
  selectionContentMove: {
    begin(duplicate: boolean): Promise<boolean>;
    update(x: number, y: number): void;
    finish(commit: boolean): void;
  };
  preciseBrushCursor: boolean;
  eyedropperActive: boolean;
  sampleSourceActive: boolean;
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
  smartSelection: {
    hover(point: { x: number; y: number }): void;
    selectPoint(point: { x: number; y: number }, mode: EditorSession['selectionCombineMode']): boolean;
    owns(pointerId: number): boolean;
    beginRegion(pointerId: number, point: { x: number; y: number }, mode: EditorSession['selectionCombineMode']): boolean;
    moveRegion(pointerId: number, point: { x: number; y: number }): boolean;
    finishRegion(pointerId: number): boolean;
    cancelRegion(pointerId: number): boolean;
  };
  paint: PaintSessionController;
  sampledBrushSource: SampledBrushSourceController;
  onSampledBrushError: (message: string | null) => void;
  onSampledBrushSourceSet: (point: { x: number; y: number }) => void;
  warp: WarpSessionController;
  faceWarp: {
    begin(pointerId: number, point: { x: number; y: number }): boolean;
    owns(pointerId: number): boolean;
    move(
      pointerId: number,
      point: { x: number; y: number },
      mode: 'sculpt' | 'relax' | 'restore'
    ): boolean;
    finish(pointerId: number): boolean;
    cancel(pointerId: number): boolean;
  };
  vector: VectorToolSessionController;
  rasterGradient: RasterGradientCommandController;
  minScale: number;
  maxScale: number;
  zoomWithScrollWheel: boolean;
  /** Undo/redo owns document publication while true; no edit gesture may start. */
  editingBlocked: boolean;
  recordPaintCommit?: boolean;
  onBrushCursorChange: (cursor: {
    center: { x: number; y: number };
    diameter: number;
    hardness?: number;
    sourceCenter?: { x: number; y: number };
    sourceMarkerSize?: number;
  } | null) => void;
  onZoomDraftChange: (draft: SelectionShape | null) => void;
  onPenRubberBandChange: (band: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null) => void;
  onPenEditingOverlayChange: (overlay: VectorEditingOverlay | null) => void;
}

export interface ViewportInteractionController {
  dragging: boolean;
  onWheel(event: WheelEvent<HTMLDivElement>): void;
  onHorizontalWheel(input: { readonly deltaX: number; readonly deltaY?: number }): void;
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
  onTransformPick,
  selectionContentMove,
  preciseBrushCursor,
  eyedropperActive,
  sampleSourceActive,
  onColorPick,
  focusPickerActive,
  onFocusPick,
  onFocusPickerEnd,
  onFill,
  onPointTextCreate,
  textGesture,
  selection,
  smartSelection,
  paint,
  sampledBrushSource,
  onSampledBrushError,
  onSampledBrushSourceSet,
  warp,
  faceWarp,
  vector,
  rasterGradient,
  minScale,
  maxScale,
  zoomWithScrollWheel,
  editingBlocked,
  recordPaintCommit = false,
  onBrushCursorChange,
  onZoomDraftChange,
  onPenRubberBandChange,
  onPenEditingOverlayChange
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
  const selectionContentMoveRef = useRef<{
    pointerId: number;
    origin: { x: number; y: number };
    current: { x: number; y: number };
    delta: { x: number; y: number };
    ready: boolean;
    ended: boolean | null;
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
  const onPenEditingOverlayChangeRef = useRef(onPenEditingOverlayChange);
  onPenEditingOverlayChangeRef.current = onPenEditingOverlayChange;
  const onColorPickRef = useRef(onColorPick);
  onColorPickRef.current = onColorPick;
  useEffect(() => {
    if (effectiveTool !== 'vector-pen') onPenEditingOverlayChangeRef.current(null);
  }, [effectiveTool]);
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
    if (!isPaintTool(effectiveTool) && !isWarpTool(effectiveTool)
      && effectiveTool !== 'face-warp' && effectiveTool !== 'select-paint-brush') {
      brushCursorCenterRef.current = null;
      onBrushCursorChangeRef.current(null);
      return;
    }
    const diameterPx = effectiveTool === 'select-paint-brush'
      ? editorSession.selectionPaintBrush.size
      : isWarpTool(effectiveTool)
      ? editorSession.warp.diameterPx
      : editorSession.brush.size;
    const hardness = effectiveTool === 'select-paint-brush'
      ? editorSession.selectionPaintBrush.hardness
      : isWarpTool(effectiveTool)
      ? editorSession.warp.hardness
      : effectiveTool === 'face-warp'
        ? undefined
        : effectiveTool === 'healing-brush'
          ? editorSession.sampledBrush.healingHardness
          : editorSession.brush.hardness;
    const sourceCenter = document && isSampledBrushTool(effectiveTool)
      ? sampledBrushSource.sourceMarkerFor(document.id, center)
      : null;
    onBrushCursorChangeRef.current({
      center,
      diameter: diameterPx,
      ...(hardness !== undefined ? { hardness } : {}),
      ...(sourceCenter ? {
        sourceCenter,
        sourceMarkerSize: 10 / Math.max(activeScale, 1e-6)
      } : {})
    });
  }, [
    effectiveTool,
    editorSession.brush.hardness,
    editorSession.brush.size,
    editorSession.selectionPaintBrush.hardness,
    editorSession.selectionPaintBrush.size,
    editorSession.sampledBrush.healingHardness,
    editorSession.warp.diameterPx,
    editorSession.warp.hardness
  ]);

  useEffect(() => () => {
    onBrushCursorChangeRef.current(null);
    onZoomDraftChangeRef.current(null);
  }, []);

  const documentPointFromSample = (
    sample: Pick<globalThis.PointerEvent, 'clientX' | 'clientY' | 'pressure' | 'pointerId' | 'pointerType'>,
    bounds: ViewportBounds
  ) => {
    if (!metadata) return null;
    const point = localToDocumentPointer(
      clientToLocalPoint(
        { x: sample.clientX, y: sample.clientY },
        { x: bounds.left, y: bounds.top }
      ),
      imageRect,
      activeScale,
      metadata,
      normalizePointerPressure(sample.pressure, sample.pointerType),
      capturedGestureUsesUnboundedDocumentPoint({
        selectionGestureMatches: selection.owns(sample.pointerId) || selection.ownsPaint(sample.pointerId),
        warpGestureMatches: warp.owns(sample.pointerId),
        paintGestureMatches: paint.owns(sample.pointerId),
        vectorGestureMatches: vector.ownsPointer(sample.pointerId),
        textGestureMatches: textGesture.owns(sample.pointerId),
        rasterGradientGestureMatches: rasterGradient.owns(sample.pointerId)
      })
        || isSelectionTool(editorSession.activeTool)
        || isVectorEditorTool(effectiveTool)
    );
    if (
      !point
      || !isSelectionTool(editorSession.activeTool)
      || editorSession.activeTool === 'select-free'
      || editorSession.activeTool === 'select-polygonal'
      || editorSession.activeTool === 'select-paint-brush'
    ) return point;
    return {
      ...point,
      x: Math.round(point.x),
      y: Math.round(point.y)
    };
  };

  const documentPoint = (event: PointerEvent<HTMLDivElement>, bounds: ViewportBounds =
    event.currentTarget.getBoundingClientRect()) => documentPointFromSample(event.nativeEvent, bounds);

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
      (!isPaintTool(effectiveTool) && !isWarpTool(effectiveTool)
        && effectiveTool !== 'face-warp' && effectiveTool !== 'select-paint-brush')
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
    const diameterPx = effectiveTool === 'select-paint-brush'
      ? editorSession.selectionPaintBrush.size
      : isWarpTool(effectiveTool)
      ? editorSession.warp.diameterPx
      : editorSession.brush.size;
    const hardness = effectiveTool === 'select-paint-brush'
      ? editorSession.selectionPaintBrush.hardness
      : isWarpTool(effectiveTool)
      ? editorSession.warp.hardness
      : effectiveTool === 'face-warp'
        ? undefined
        : effectiveTool === 'healing-brush'
          ? editorSession.sampledBrush.healingHardness
          : editorSession.brush.hardness;
    const center = {
      x: (point.x - imageRect.x) / Math.max(activeScale, 1e-6),
      y: (point.y - imageRect.y) / Math.max(activeScale, 1e-6)
    };
    brushCursorCenterRef.current = center;
    const sourceCenter = document && isSampledBrushTool(effectiveTool)
      ? sampledBrushSource.sourceMarkerFor(document.id, center)
      : null;
    onBrushCursorChangeRef.current({
      center,
      diameter: diameterPx,
      ...(hardness !== undefined ? { hardness } : {}),
      ...(sourceCenter ? {
        sourceCenter,
        sourceMarkerSize: 10 / Math.max(activeScale, 1e-6)
      } : {})
    });
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

  const scheduleWheelPan = (deltaX: number, deltaY: number, deltaMode: number) => {
    if (!metadata) return;
    const deltaMultiplier = deltaMode === 1
      ? 16
      : deltaMode === 2 ? viewportSize.height : 1;
    setZoomMode('custom');
    const pendingView = zoomFrameRef.current?.pending();
    const baseView = pendingView ?? {
      scale: activeScale,
      panX: view.panX,
      panY: view.panY
    };
    const pan = panViewFromWheel({
      initialView: baseView,
      deltaX,
      deltaY,
      deltaMultiplier
    });
    zoomFrameRef.current?.schedule({ ...baseView, ...pan });
  };

  return {
    dragging: Boolean(dragRef.current),
    hideBrushCursor,
    onWheel: (event) => {
      if (!metadata) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (!zoomWithScrollWheel && !event.ctrlKey && !event.metaKey) {
        const nativeWheel = event.nativeEvent as globalThis.WheelEvent & {
          readonly wheelDeltaX?: number;
        };
        const wheelDelta = resolveWheelPanDeltas({
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          legacyWheelDeltaX: nativeWheel.wheelDeltaX,
          shiftKey: event.shiftKey
        });
        scheduleWheelPan(wheelDelta.deltaX, wheelDelta.deltaY, event.deltaMode);
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
    onHorizontalWheel: ({ deltaX, deltaY = 0 }) => {
      if (zoomWithScrollWheel || !Number.isFinite(deltaX) || deltaX === 0) return;
      scheduleWheelPan(deltaX, Number.isFinite(deltaY) ? deltaY : 0, 0);
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
      if (editingBlocked && !temporaryPan) {
        event.preventDefault();
        return;
      }
      if (eyedropperActive && point && event.button === 0) {
        onColorPickRef.current(point);
        event.preventDefault();
        return;
      }
      const activeTool = effectiveTool;
      if (
        point
        && event.button === 0
        && (event.ctrlKey || event.metaKey)
        && isSelectionTool(editorSession.activeTool)
        && editorSession.selection.length > 0
        && selection.contains(point)
      ) {
        const gesture = {
          pointerId: event.pointerId,
          origin: { x: point.x, y: point.y },
          current: { x: point.x, y: point.y },
          delta: { x: 0, y: 0 },
          ready: false,
          ended: null as boolean | null
        };
        selectionContentMoveRef.current = gesture;
        event.currentTarget.setPointerCapture(event.pointerId);
        void selectionContentMove.begin(event.altKey).then((ready) => {
          if (selectionContentMoveRef.current !== gesture) {
            if (ready) selectionContentMove.finish(false);
            return;
          }
          if (!ready) {
            selectionContentMoveRef.current = null;
            return;
          }
          gesture.ready = true;
          selectionContentMove.update(
            gesture.delta.x,
            gesture.delta.y
          );
          if (gesture.ended !== null) {
            selectionContentMoveRef.current = null;
            selectionContentMove.finish(gesture.ended);
          }
        }).catch(() => {
          if (selectionContentMoveRef.current === gesture) {
            selectionContentMoveRef.current = null;
          }
        });
        event.preventDefault();
        return;
      }
      if (
        isSampledBrushTool(activeTool)
        && (event.altKey || sampleSourceActive)
        && point
        && event.button === 0
        && document
        && !temporaryPan
      ) {
        const sourceLayer = findDocumentLayer(document, document.activeLayerId);
        if (!sourceLayer || !sourceLayer.visible) {
          onSampledBrushError('Choose a visible source layer before sampling.');
          event.preventDefault();
          return;
        }
        sampledBrushSource.setSource(document, sourceLayer, point);
        onSampledBrushError(null);
        onSampledBrushSourceSet(point);
        const center = brushCursorCenterRef.current ?? { x: point.x, y: point.y };
        onBrushCursorChangeRef.current({
          center,
          diameter: editorSession.brush.size,
          sourceCenter: { x: point.x, y: point.y },
          sourceMarkerSize: 10 / Math.max(activeScale, 1e-6)
        });
        event.preventDefault();
        return;
      }
      const activeBrushPreset = resolveBrushPreset(editorSession.brush.presetId);
      const liquifyBrushActive = activeTool === 'brush' && activeBrushPreset.engine === 'warp';
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
        const handled = vector.pointerDown(event.pointerId, point, {
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
        });
        onPenEditingOverlayChangeRef.current(vector.penEditingOverlay());
        if (handled) {
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
      if (activeTool === 'face-warp' && point && event.button === 0 && !temporaryPan) {
        if (faceWarp.begin(event.pointerId, point)) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        return;
      }
      const intent = resolveViewportPointerDownIntent({
        activeTool: liquifyBrushActive ? 'warp' : activeTool,
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
      if (intent === 'transform-pick' && point) {
        onTransformPick(point, event.shiftKey);
        event.preventDefault();
        return;
      }
      if (
        intent === 'selection'
        && point
        && activeTool === 'select-paint-brush'
      ) {
        const mode = event.altKey || editorSession.selectionCombineMode === 'subtract'
          ? 'subtract'
          : 'add';
        if (selection.beginPaint(
          event.pointerId,
          point,
          mode,
          editorSession.selectionPaintBrush
        )) {
          setEditorSession((current) => ({ ...current, pointerId: event.pointerId }));
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }
      if (
        intent === 'selection'
        && point
        && activeTool === 'select-object'
      ) {
        const selectionCombineMode = resolveSelectionCombineMode(
          editorSession.selectionCombineMode,
          event.shiftKey,
          event.altKey
        );
        if (editorSession.smartSelection.mode === 'object-finder') {
          if (smartSelection.selectPoint(point, selectionCombineMode)) event.preventDefault();
        } else if (smartSelection.beginRegion(
          event.pointerId,
          point,
          selectionCombineMode
        )) {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }
        return;
      }
      if (
        intent === 'selection'
        && point
        && activeTool === 'select-magic-wand'
      ) {
        const selectionCombineMode = resolveSelectionCombineMode(
          editorSession.selectionCombineMode,
          event.shiftKey,
          event.altKey
        );
        if (selection.magicWand(point, selectionCombineMode, editorSession.magicWand)) {
          event.preventDefault();
        }
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
          event.timeStamp,
          {
            featherRadius: editorSession.selectionFeather,
            antiAlias: editorSession.selectionAntiAlias
          }
        )) {
          event.preventDefault();
        }
        return;
      }
      if (
        intent === 'selection'
        && point
        && isSelectionTool(activeTool)
        && activeTool !== 'select-magic-wand'
        && activeTool !== 'select-object'
        && activeTool !== 'select-paint-brush'
      ) {
        const geometricModifiers = (
          activeTool === 'select-rectangle' || activeTool === 'select-ellipse'
        ) && editorSession.selection.length === 0
          && editorSession.selectionCombineMode === 'replace';
        const selectionCombineMode = geometricModifiers
          ? 'replace'
          : resolveSelectionCombineMode(
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
          stripSize,
          activeTool === 'select-free' ? editorSession.selectionSmooth : 0,
          48 / Math.max(activeScale, 0.0001),
          event.ctrlKey || event.metaKey,
          activeTool === 'select-rectangle' || activeTool === 'select-ellipse'
            ? {
                style: editorSession.selectionMarqueeStyle,
                width: editorSession.selectionMarqueeWidth,
                height: editorSession.selectionMarqueeHeight,
                featherRadius: editorSession.selectionFeather,
                constrainAspect: geometricModifiers && event.shiftKey,
                fromCenter: geometricModifiers && event.altKey
              }
            : undefined,
          activeTool === 'select-free'
            ? {
                featherRadius: editorSession.selectionFeather,
                antiAlias: editorSession.selectionAntiAlias
              }
            : undefined
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
        const warpSettings = liquifyBrushActive ? {
          diameterPx: editorSession.brush.size,
          strength: editorSession.brush.opacity,
          hardness: editorSession.brush.hardness,
          flow: editorSession.brush.flow,
          spacing: editorSession.brush.spacing,
          smooth: editorSession.brush.smooth,
          pressureSize: false,
          pressureStrength: true
        } : {
          diameterPx: editorSession.warp.diameterPx,
          strength: editorSession.warp.strength,
          hardness: editorSession.warp.hardness,
          flow: editorSession.warp.flow,
          spacing: editorSession.warp.spacing,
          smooth: editorSession.warp.smooth,
          pressureSize: editorSession.warp.pressureSize,
          pressureStrength: editorSession.warp.pressureStrength
        };
        const started = warp.begin({
          pointerId: event.pointerId,
          mode: liquifyBrushActive ? 'push' : editorSession.warp.mode,
          settings: warpSettings,
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
      const sampledOperation = isSampledBrushTool(activeTool) && document
        ? sampledBrushSource.beginStroke(
            activeTool,
            document,
            point,
            editorSession.sampledBrush
          )
        : null;
      if (isSampledBrushTool(activeTool) && !sampledOperation) {
        onSampledBrushError('Alt-click the document to choose a sample source first.');
        event.preventDefault();
        return;
      }
      if (sampledOperation
        && sampledOperation.sampleMode !== 'all'
        && !findDocumentLayer(document!, sampledOperation.source.anchorLayerId)) {
        sampledBrushSource.clear();
        onSampledBrushError('The sampled source layer no longer exists. Choose a new source.');
        event.preventDefault();
        return;
      }
      if (sampledOperation) onSampledBrushError(null);
      const toneOperation: ToneBrushStrokePlan | null = isToneBrushTool(activeTool)
        ? {
            operator: 'tone',
            mode: activeTool,
            range: editorSession.toneBrush.range,
            spongeMode: editorSession.toneBrush.spongeMode,
            protectTones: editorSession.toneBrush.protectTones,
            vibrance: editorSession.toneBrush.vibrance
          }
        : null;
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
        brush: toneOperation
          ? {
              ...editorSession.brush,
              presetId: 'round',
              opacity: 1,
              // Photoshop's default round tone-brush stroke spaces requested
              // dabs at 25% of the diameter. Dense GPU resampling remains in
              // place; RasterPaintService preserves the requested buildup.
              spacing: 0.25,
              flow: activeTool === 'sponge'
                ? editorSession.toneBrush.spongeFlow
                : calibratedToneExposure(
                    activeTool === 'burn' ? 'burn' : 'dodge',
                    editorSession.toneBrush.exposure,
                    editorSession.toneBrush.protectTones
                  )
            }
          : activeTool === 'healing-brush'
          ? {
              ...editorSession.brush,
              hardness: editorSession.sampledBrush.healingHardness,
              opacity: editorSession.sampledBrush.healingOpacity
            }
          : editorSession.brush,
        point: paintPoint,
        displayScale: activeScale,
        operator: sampledOperation ?? toneOperation ?? undefined,
        recordSemanticCommit: recordPaintCommit
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
      const contentMove = selectionContentMoveRef.current;
      if (point && contentMove?.pointerId === event.pointerId) {
        contentMove.current = { x: point.x, y: point.y };
        let dx = point.x - contentMove.origin.x;
        let dy = point.y - contentMove.origin.y;
        if (event.shiftKey && (dx || dy)) {
          const distance = Math.hypot(dx, dy);
          const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          dx = Math.cos(angle) * distance;
          dy = Math.sin(angle) * distance;
        }
        contentMove.delta = { x: dx, y: dy };
        if (contentMove.ready) selectionContentMove.update(dx, dy);
        event.preventDefault();
        return;
      }
      if (point && selection.ownsPaint(event.pointerId)) {
        const points = coalescedPointerSamples(event.nativeEvent)
          .map((sample) => documentPointFromSample(sample, bounds))
          .filter((sample): sample is BrushPoint => Boolean(sample));
        if (selection.movePaint(event.pointerId, points)) event.preventDefault();
        return;
      }
      if (point && smartSelection.owns(event.pointerId)) {
        if (smartSelection.moveRegion(event.pointerId, point)) event.preventDefault();
        return;
      }
      if (point && effectiveTool === 'select-object'
        && editorSession.smartSelection.mode === 'object-finder'
        && event.buttons === 0) {
        smartSelection.hover(point);
      }
      if (point && faceWarp.owns(event.pointerId)) {
        const mode = event.altKey ? 'restore' : event.shiftKey ? 'relax' : 'sculpt';
        if (faceWarp.move(event.pointerId, point, mode)) event.preventDefault();
        return;
      }
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
        const handled = vector.pointerMove(event.pointerId, point, {
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
        onPenEditingOverlayChangeRef.current(vector.penEditingOverlay());
        if (handled) event.preventDefault();
        return;
      }
      if (effectiveTool === 'vector-pen') {
        onPenRubberBandChangeRef.current(
          point ? vector.penRubberBand(point) : null
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
      if (point && (intent === 'selection' || intent === 'warp' || intent === 'paint')) {
        if (routeFreehandPointerMove({
          intent, activeTool: editorSession.activeTool, pointerId: event.pointerId,
          currentPoint: point, samples: coalescedPointerSamples(event.nativeEvent),
          // PointerEvent coordinates live on the native event prototype and
          // disappear when the event is object-spread. Preserve the native
          // sample so drag interpolation receives its real coordinates.
          project: (sample) => documentPointFromSample(sample, bounds), selection, warp, paint,
          snapBypass: event.ctrlKey || event.metaKey,
          repositionSelection: temporaryPan,
          selectionMarqueeModifiers: (
            editorSession.activeTool === 'select-rectangle'
            || editorSession.activeTool === 'select-ellipse'
          ) && editorSession.selection.length === 0
            && editorSession.selectionCombineMode === 'replace'
            ? { constrainAspect: event.shiftKey, fromCenter: event.altKey }
            : undefined,
          constrainSelectionTranslation: event.shiftKey
        })) event.preventDefault();
      }
    },
    onPointerUp: (event) => {
      const contentMove = selectionContentMoveRef.current;
      if (contentMove?.pointerId === event.pointerId) {
        contentMove.ended = true;
        if (contentMove.ready) {
          selectionContentMoveRef.current = null;
          selectionContentMove.finish(true);
        }
        event.preventDefault();
        return;
      }
      if (smartSelection.owns(event.pointerId)) {
        if (smartSelection.finishRegion(event.pointerId)) event.preventDefault();
        return;
      }
      if (faceWarp.owns(event.pointerId)) {
        if (faceWarp.finish(event.pointerId)) event.preventDefault();
        return;
      }
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
        onPenEditingOverlayChangeRef.current(vector.penEditingOverlay());
        event.preventDefault();
        return;
      }
      if (selection.ownsPaint(event.pointerId)) {
        selection.finishPaint(event.pointerId);
        setEditorSession((current) => ({ ...current, pointerId: null }));
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
      const contentMove = selectionContentMoveRef.current;
      if (contentMove?.pointerId === event.pointerId) {
        contentMove.ended = false;
        if (contentMove.ready) {
          selectionContentMoveRef.current = null;
          selectionContentMove.finish(false);
        }
        event.preventDefault();
        return;
      }
      if (smartSelection.owns(event.pointerId)) {
        if (smartSelection.cancelRegion(event.pointerId)) event.preventDefault();
        return;
      }
      if (faceWarp.owns(event.pointerId)) {
        if (faceWarp.cancel(event.pointerId)) event.preventDefault();
        return;
      }
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
      onPenEditingOverlayChangeRef.current(vector.penEditingOverlay());
      selection.cancelPaint(event.pointerId);
      selection.cancel(event.pointerId);
      warp.cancel(event.pointerId);
      paint.cancel(event.pointerId);
      setEditorSession((current) => ({ ...current, pointerId: null }));
      endPan(event);
    }
  };
};
