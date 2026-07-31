import {
  useEffect,
  useRef,
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent
} from 'react';
import type { PaintSessionController } from '../../application/tools/paint/usePaintSessionController';
import type { SelectionSessionController } from '../../application/tools/selection/useSelectionSessionController';
import {
  resolveViewportPointerDownIntent,
  resolveViewportPointerEndIntent,
  resolveViewportPointerMoveIntent
} from '../../application/input/viewportPointerRouter';
import type { ImageDocument, Rect } from '../document/documentTypes';
import { findDocumentLayer, findRasterLayer } from '../document/layerTree';
import type { EditorSession } from '../session/editorSession';
import { paintTargetSourceToDocument } from '../tools/paint/paintCoordinates';
import { isPaintTool, isSelectionTool } from '../tools/toolCapabilities';
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

interface ViewportSize {
  width: number;
  height: number;
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

  useEffect(() => {
    const cursor = brushCursorRef.current;
    const center = brushCursorCenterRef.current;
    if (!cursor || !center) return;
    const diameter = Math.max(2, editorSession.brush.size * activeScale);
    cursor.style.width = `${diameter}px`;
    cursor.style.height = `${diameter}px`;
    cursor.style.transform =
      `translate3d(${center.x - diameter / 2}px, ${center.y - diameter / 2}px, 0)`;
  }, [activeScale, editorSession.brush.size]);

  const documentPoint = (event: PointerEvent<HTMLDivElement>) => {
    if (!metadata) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
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

  const updateBrushCursor = (event: PointerEvent<HTMLDivElement>) => {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    if (!isPaintTool(editorSession.activeTool) || temporaryTools.active || focusPickerActive || !metadata) {
      hideBrushCursor();
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = clientToLocalPoint(
      { x: event.clientX, y: event.clientY },
      { x: bounds.left, y: bounds.top }
    );
    if (!pointInsideRect(point, imageRect)) {
      hideBrushCursor();
      return;
    }
    const diameter = Math.max(2, editorSession.brush.size * activeScale);
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
    setView((current) => ({ ...current, ...pan }));
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
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
      setView(zoomViewAtPoint({
        cursor,
        viewport: viewportSize,
        view: { scale: activeScale, panX: view.panX, panY: view.panY },
        wheelDelta: event.deltaY,
        minScale,
        maxScale
      }));
    },
    onPointerDown: (event) => {
      updateBrushCursor(event);
      if (
        editorSession.activeTool === 'zoom'
        && !temporaryTools.active
        && event.button === 0
        && metadata
      ) {
        const bounds = event.currentTarget.getBoundingClientRect();
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
      const point = documentPoint(event);
      const activeTool = editorSession.activeTool;
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
        hasPaintTarget: Boolean(paintTarget)
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
      updateBrushCursor(event);
      const point = documentPoint(event);
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
      if (intent === 'paint' && point && paint.move(event.pointerId, point)) {
        event.preventDefault();
      }
    },
    onPointerUp: (event) => {
      const intent = resolveViewportPointerEndIntent({
        selectionGestureMatches: selection.owns(event.pointerId),
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
      endPan(event);
    },
    onPointerCancel: (event) => {
      selection.cancel(event.pointerId);
      paint.cancel(event.pointerId);
      setEditorSession((current) => ({ ...current, pointerId: null }));
      endPan(event);
    }
  };
};
