import React from 'react';
import type { DocumentGuide, Rect } from '../document/documentTypes';
import { SelectionOverlay } from '../selection/SelectionOverlay';
import type {
  SelectionOperation,
  SelectionShape
} from '../selection/selectionTypes';
import { TransformOverlay } from '../tools/transform/TransformOverlay';
import type {
  AffineMatrix,
  TransformQuad,
  TransformSessionState
} from '../tools/transform/transformTypes';
import type { ToolId } from '../session/editorSession';
import type { SnapFeature, SnapMatch } from '../../application/tools/snapping/snapEngine';
import { LayoutGuideInteractionLayer } from './LayoutGuideInteractionLayer';

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
  loading: boolean;
  unavailable: boolean;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
  onPointerLeave: React.PointerEventHandler<HTMLDivElement>;
  onContextMenu: React.MouseEventHandler<HTMLDivElement>;
  onTransformChange: (matrix: AffineMatrix) => void;
  onTransformProjectiveChange: (quad: TransformQuad) => void;
  onTransformDuplicateChange: (duplicate: boolean) => void;
  onTransformPick: (point: { x: number; y: number }) => void;
  transformSnapTargets?: readonly SnapFeature[];
  transformSnapEnabled?: boolean;
  onTransformSnapMatches?: (matches: readonly SnapMatch[]) => void;
  documentGuides?: readonly DocumentGuide[];
  rulersVisible?: boolean;
  guidesVisible?: boolean;
  guidesLocked?: boolean;
  onGuideDraft?: (guides: readonly DocumentGuide[] | null) => void;
  onGuideCommit?: (guides: readonly DocumentGuide[]) => void;
  inputBridge?: React.ReactNode;
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
  onTransformDuplicateChange,
  onTransformPick,
  transformSnapTargets,
  transformSnapEnabled,
  onTransformSnapMatches,
  documentGuides = [],
  rulersVisible = false,
  guidesVisible = false,
  guidesLocked = false,
  onGuideDraft,
  onGuideCommit,
  inputBridge
}) => {
  const effectiveTool = temporaryPanActive
    ? 'view'
    : temporaryZoomActive
      ? 'zoom'
      : activeTool;
  return (
    <div
      ref={viewportRef}
      className={`lighttable-viewport lighttable-viewport--${effectiveTool}${zoomOutActive ? ' lighttable-viewport--zoom-out' : ''}${preciseBrushCursor ? ' lighttable-viewport--precise-brush' : ''}${eyedropperActive ? ' lighttable-viewport--eyedropper' : ''}${dragging ? ' lighttable-viewport--dragging' : ''}${focusPickerActive ? ' lighttable-viewport--focus-picker' : ''}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} className="lighttable-viewport__canvas" />
      {(rulersVisible || (guidesVisible && documentGuides.length > 0))
        && onGuideDraft && onGuideCommit ? (
          <LayoutGuideInteractionLayer
            imageRect={imageRect}
            scale={scale}
            guides={documentGuides}
            rulersVisible={rulersVisible}
            guidesVisible={guidesVisible}
            guidesLocked={guidesLocked}
            interactive={activeTool === 'transform'}
            onDraft={onGuideDraft}
            onCommit={onGuideCommit}
          />
        ) : null}
      {inputBridge}
      {extrasVisible && activeTool !== 'view' && (selection.length || selectionDraft) ? (
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
          onProjectiveChange={onTransformProjectiveChange}
          onDuplicateChange={onTransformDuplicateChange}
          onPickLayer={onTransformPick}
          snapTargets={transformSnapTargets}
          snapEnabled={transformSnapEnabled}
          onSnapMatches={onTransformSnapMatches}
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
