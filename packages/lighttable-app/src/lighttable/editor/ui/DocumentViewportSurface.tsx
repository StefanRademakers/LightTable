import React from "react";
import type { DocumentGuide, Rect } from "../document/documentTypes";
import { SelectionOverlay } from "../selection/SelectionOverlay";
import type {
  SelectionOperation,
  SelectionShape,
} from "../selection/selectionTypes";
import { TransformOverlay } from "../tools/transform/TransformOverlay";
import type {
  AffineMatrix,
  TransformQuad,
  TransformSessionState,
} from "../tools/transform/transformTypes";
import type {
  TransformFrameMode,
  TransformSessionFrame,
} from "../tools/transform/transformSessionFrame";
import type { ToolId } from "../session/editorSession";
import type {
  SnapFeature,
  SnapGrid,
  SnapMatch,
} from "../../application/tools/snapping/snapEngine";
import { LayoutGuideInteractionLayer } from "./LayoutGuideInteractionLayer";
import { CropInteractionOverlay } from "../tools/crop/CropInteractionOverlay";
import {
  FilterCenterOverlay,
  type FilterCenterPoint,
} from "../filters/FilterCenterOverlay";
import type { FilterInteractionAdmission } from "../../application/filters/useP0FilterController";

export interface DocumentViewportSurfaceProps {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  activeTool: ToolId;
  temporaryPanActive: boolean;
  temporaryZoomActive: boolean;
  zoomOutActive: boolean;
  preciseBrushCursor: boolean;
  eyedropperActive: boolean;
  dragging: boolean;
  focusPickerActive: boolean;
  selection: SelectionOperation[];
  selectionDraft: SelectionShape | null;
  extrasVisible?: boolean;
  imageRect: Rect;
  scale: number;
  viewportSize: { width: number; height: number };
  transformState: TransformSessionState | null;
  /** True only after this document generation has presented into the canvas. */
  presentationReady?: boolean;
  loading: boolean;
  unavailable: boolean;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
  onPointerLeave: React.PointerEventHandler<HTMLDivElement>;
  onContextMenu: React.MouseEventHandler<HTMLDivElement>;
  onTransformChange: (matrix: AffineMatrix, matches: readonly SnapMatch[]) => boolean;
  onTransformProjectiveChange: (quad: TransformQuad, matches: readonly SnapMatch[]) => boolean;
  onTransformCommitGesture: () => void;
  onTransformDuplicateChange: (duplicate: boolean) => void;
  onTransformPick: (point: { x: number; y: number }, extend: boolean) => void;
  getTransformSnapTargets?: () => readonly SnapFeature[];
  transformSnapEnabled?: boolean;
  transformSnapGrid?: SnapGrid | null;
  transformFrameMode?: TransformFrameMode;
  transformFrameOverride?: TransformSessionFrame | null;
  onTransformSnapMatches?: (matches: readonly SnapMatch[]) => void;
  onTransformViewportPan?: (deltaX: number, deltaY: number) => void;
  documentGuides?: readonly DocumentGuide[];
  rulersVisible?: boolean;
  guidesVisible?: boolean;
  guidesLocked?: boolean;
  onGuideDraft?: (guides: readonly DocumentGuide[] | null) => void;
  onGuideCommit?: (guides: readonly DocumentGuide[]) => void;
  inputBridge?: React.ReactNode;
  cropBounds?: Rect | null;
  documentWidth?: number;
  documentHeight?: number;
  onCropChange?: (bounds: Rect) => void;
  onCropCommit?: () => void;
  onCropCancel?: () => void;
  filterCenter?: FilterCenterPoint | null;
  onFilterCenterChange?: (center: FilterCenterPoint, admission: FilterInteractionAdmission) => void;
  onFilterCenterInteractionStart?: () => FilterInteractionAdmission;
  onFilterCenterInteractionEnd?: (admission: FilterInteractionAdmission) => void;
  onFilterCenterInteractionCancel?: (admission: FilterInteractionAdmission) => void;
}

/**
 * Pure document viewport composition.
 *
 * Pointer interpretation and mutations stay in application/tool controllers;
 * this component owns only the visual surface and overlays. That keeps future
 * document tabs free to mount independent canvases without duplicating root UI.
 */
export const DocumentViewportSurface: React.FC<
  DocumentViewportSurfaceProps
> = ({
  viewportRef,
  canvasRef,
  activeTool,
  temporaryPanActive,
  temporaryZoomActive,
  zoomOutActive,
  preciseBrushCursor,
  eyedropperActive,
  dragging,
  focusPickerActive,
  selection,
  selectionDraft,
  extrasVisible = true,
  imageRect,
  scale,
  viewportSize,
  transformState,
  presentationReady = true,
  loading,
  unavailable,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  onContextMenu,
  onTransformChange,
  onTransformProjectiveChange,
  onTransformCommitGesture,
  onTransformDuplicateChange,
  onTransformPick,
  getTransformSnapTargets,
  transformSnapEnabled,
  transformSnapGrid,
  transformFrameMode,
  transformFrameOverride,
  onTransformSnapMatches,
  onTransformViewportPan,
  documentGuides = [],
  rulersVisible = false,
  guidesVisible = false,
  guidesLocked = false,
  onGuideDraft,
  onGuideCommit,
  inputBridge,
  cropBounds = null,
  documentWidth = 0,
  documentHeight = 0,
  onCropChange,
  onCropCommit,
  onCropCancel,
  filterCenter = null,
  onFilterCenterChange,
  onFilterCenterInteractionStart,
  onFilterCenterInteractionEnd,
  onFilterCenterInteractionCancel,
}) => {
  const effectiveTool = temporaryPanActive
    ? "view"
    : temporaryZoomActive
      ? "zoom"
      : activeTool;
  const beginViewportPointer: React.PointerEventHandler<HTMLDivElement> = (
    event,
  ) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const targetIsEditor = Boolean(
      target?.closest('input, textarea, select, [contenteditable="true"]'),
    );
    if (!targetIsEditor && document.activeElement instanceof HTMLElement) {
      const focused = document.activeElement;
      if (focused.matches('input, textarea, select, [contenteditable="true"]'))
        focused.blur();
    }
    if (presentationReady) onPointerDown(event);
  };
  return (
    <div
      ref={viewportRef}
      className={`lighttable-viewport lighttable-viewport--${effectiveTool}${presentationReady ? "" : " lighttable-viewport--presentation-pending"}${zoomOutActive ? " lighttable-viewport--zoom-out" : ""}${preciseBrushCursor ? " lighttable-viewport--precise-brush" : ""}${eyedropperActive ? " lighttable-viewport--eyedropper" : ""}${dragging ? " lighttable-viewport--dragging" : ""}${focusPickerActive ? " lighttable-viewport--focus-picker" : ""}`}
      aria-busy={!presentationReady || loading}
      data-presentation-ready={presentationReady ? "true" : "false"}
      onWheel={presentationReady ? onWheel : undefined}
      onPointerDown={beginViewportPointer}
      onPointerMove={presentationReady ? onPointerMove : undefined}
      onPointerUp={presentationReady ? onPointerUp : undefined}
      onPointerCancel={presentationReady ? onPointerCancel : undefined}
      onPointerLeave={presentationReady ? onPointerLeave : undefined}
      onContextMenu={presentationReady ? onContextMenu : undefined}
    >
      <canvas ref={canvasRef} className="lighttable-viewport__canvas" />
      {cropBounds && onCropChange && onCropCommit && onCropCancel ? (
        <CropInteractionOverlay
          bounds={cropBounds}
          documentWidth={documentWidth}
          documentHeight={documentHeight}
          imageRect={imageRect}
          scale={scale}
          onChange={onCropChange}
          onCommit={onCropCommit}
          onCancel={onCropCancel}
        />
      ) : null}
      {(rulersVisible || (guidesVisible && documentGuides.length > 0)) &&
      onGuideDraft &&
      onGuideCommit ? (
        <LayoutGuideInteractionLayer
          imageRect={imageRect}
          scale={scale}
          guides={documentGuides}
          rulersVisible={rulersVisible}
          guidesVisible={guidesVisible}
          guidesLocked={guidesLocked}
          interactive={activeTool === "transform"}
          onDraft={onGuideDraft}
          onCommit={onGuideCommit}
        />
      ) : null}
      {inputBridge}
      {extrasVisible && (selection.length || selectionDraft) ? (
        <SelectionOverlay
          operations={selection}
          draft={selectionDraft}
          imageRect={imageRect}
          scale={scale}
          width={viewportSize.width}
          height={viewportSize.height}
        />
      ) : null}
      {extrasVisible &&
      filterCenter &&
      documentWidth > 0 &&
      documentHeight > 0 &&
      onFilterCenterChange &&
      onFilterCenterInteractionStart &&
      onFilterCenterInteractionEnd &&
      onFilterCenterInteractionCancel ? (
        <FilterCenterOverlay
          center={filterCenter}
          imageRect={imageRect}
          scale={scale}
          width={viewportSize.width}
          height={viewportSize.height}
          documentWidth={documentWidth}
          documentHeight={documentHeight}
          interactive={!temporaryPanActive && !temporaryZoomActive}
          onChange={onFilterCenterChange}
          onInteractionStart={onFilterCenterInteractionStart}
          onInteractionEnd={onFilterCenterInteractionEnd}
          onInteractionCancel={onFilterCenterInteractionCancel}
        />
      ) : null}
      {transformState ? (
        <TransformOverlay
          state={transformState}
          interactive={effectiveTool === "transform"}
          imageRect={imageRect}
          scale={scale}
          width={viewportSize.width}
          height={viewportSize.height}
          onChange={onTransformChange}
          onProjectiveChange={onTransformProjectiveChange}
          onCommitGesture={onTransformCommitGesture}
          onDuplicateChange={onTransformDuplicateChange}
          onPickLayer={onTransformPick}
          getSnapTargets={getTransformSnapTargets}
          snapEnabled={transformSnapEnabled}
          snapGrid={transformSnapGrid}
          frameMode={transformFrameMode}
          frameOverride={transformFrameOverride}
          onSnapMatches={onTransformSnapMatches}
          onViewportPan={onTransformViewportPan}
        />
      ) : null}
      {loading || !presentationReady ? (
        <div className="lighttable-viewport__message">
          Loading image and WebGPU pipeline...
        </div>
      ) : null}
      {!loading && presentationReady && unavailable ? (
        <div className="lighttable-viewport__message">
          LightTable is unavailable for this image.
        </div>
      ) : null}
    </div>
  );
};
