import React from 'react';
import type { Rect } from '../document/documentTypes';
import { SelectionOverlay } from '../selection/SelectionOverlay';
import type {
  SelectionOperation,
  SelectionShape
} from '../selection/selectionTypes';
import { TransformOverlay } from '../tools/transform/TransformOverlay';
import type {
  AffineMatrix,
  TransformSessionState
} from '../tools/transform/transformTypes';
import type { ToolId } from '../session/editorSession';

export interface DocumentViewportSurfaceProps {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  brushCursorRef: React.RefObject<HTMLDivElement | null>;
  activeTool: ToolId;
  temporaryPanActive: boolean;
  dragging: boolean;
  focusPickerActive: boolean;
  showBrushCursor: boolean;
  selection: SelectionOperation[];
  selectionDraft: SelectionShape | null;
  imageRect: Rect;
  scale: number;
  viewportSize: { width: number; height: number };
  transformState: TransformSessionState | null;
  loading: boolean;
  unavailable: boolean;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
  onPointerLeave: React.PointerEventHandler<HTMLDivElement>;
  onTransformChange: (matrix: AffineMatrix) => void;
}

/**
 * Pure document viewport composition.
 *
 * Pointer interpretation and mutations stay in application/tool controllers;
 * this component owns only the visual surface and overlays. That keeps future
 * document tabs free to mount independent canvases without duplicating root UI.
 */
export const DocumentViewportSurface: React.FC<DocumentViewportSurfaceProps> = ({
  viewportRef,
  canvasRef,
  brushCursorRef,
  activeTool,
  temporaryPanActive,
  dragging,
  focusPickerActive,
  showBrushCursor,
  selection,
  selectionDraft,
  imageRect,
  scale,
  viewportSize,
  transformState,
  loading,
  unavailable,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onTransformChange
}) => {
  const effectiveTool = temporaryPanActive ? 'view' : activeTool;
  return (
    <div
      ref={viewportRef}
      className={`lighttable-viewport lighttable-viewport--${effectiveTool}${dragging ? ' lighttable-viewport--dragging' : ''}${focusPickerActive ? ' lighttable-viewport--focus-picker' : ''}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
    >
      <canvas ref={canvasRef} className="lighttable-viewport__canvas" />
      {showBrushCursor && !temporaryPanActive ? (
        <div ref={brushCursorRef} className="lighttable-brush-cursor" aria-hidden="true" />
      ) : null}
      {activeTool !== 'view' && (selection.length || selectionDraft) ? (
        <SelectionOverlay
          operations={selection}
          draft={selectionDraft}
          imageRect={imageRect}
          scale={scale}
          width={viewportSize.width}
          height={viewportSize.height}
        />
      ) : null}
      {transformState ? (
        <TransformOverlay
          state={transformState}
          imageRect={imageRect}
          scale={scale}
          width={viewportSize.width}
          height={viewportSize.height}
          onChange={onTransformChange}
        />
      ) : null}
      {loading ? (
        <div className="lighttable-viewport__message">
          Loading image and WebGPU pipeline...
        </div>
      ) : null}
      {!loading && unavailable ? (
        <div className="lighttable-viewport__message">
          LightTable is unavailable for this image.
        </div>
      ) : null}
    </div>
  );
};
