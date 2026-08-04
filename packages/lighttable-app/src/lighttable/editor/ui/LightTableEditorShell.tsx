import React, { type ChangeEvent, type RefObject } from 'react';
import { SquareIconButton } from '../../../ui/SquareIconButton';
import type { ContextMenuOption } from '../../../ui/ContextMenu';
import { lightTableIcon } from '../../../assets/icons';
import type { EditorMenuId } from '../menus/createEditorMenuOptions';
import type { EditorSession, ToolId } from '../session/editorSession';
import { EditorMenuBar } from './EditorMenuBar';
import { EditorToolbar } from './EditorToolbar';
import { ToolOptionsBar } from './ToolOptionsBar';
import type { EditorScreenMode } from '../workspace/editorScreenMode';
import type { TextPropertyPresentation } from '../../application/text/textPropertyPresentation';
import type { TextPaint } from '@lighttable/text-core';

export interface LightTableEditorShellProps {
  screenMode: EditorScreenMode;
  active: boolean;
  saving: boolean;
  onClose: () => void;
  menuOptionsFor: (menuId: EditorMenuId) => Array<ContextMenuOption<string>>;
  activeTool: ToolId;
  brush: EditorSession['brush'];
  gradient: EditorSession['gradient'];
  shape: EditorSession['shape'];
  warp: EditorSession['warp'];
  vectorStyle: EditorSession['vectorStyle'];
  text: EditorSession['text'];
  textFonts: readonly import('../document/documentTypes').DocumentFontAsset[];
  textProperties?: TextPropertyPresentation | null;
  textLayoutMode?: 'point' | 'paragraph' | null;
  selectedVectorStyle: EditorSession['vectorStyle'] | null;
  selectedShape: EditorSession['shape'] | null;
  selectedShapeKind: 'rectangle' | 'ellipse' | 'line' | null;
  selectionPixelSnap: boolean;
  selectionCombineMode: EditorSession['selectionCombineMode'];
  selectionRowHeight: number;
  selectionColumnWidth: number;
  zoomPercent: number;
  onBrushChange: (change: Partial<EditorSession['brush']>) => void;
  onGradientChange: (change: Partial<EditorSession['gradient']>) => void;
  onShapeChange: (change: Partial<EditorSession['shape']>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onVectorStyleChange: (change: Partial<EditorSession['vectorStyle']>) => void;
  onTextChange: (change: Partial<EditorSession['text']>) => void;
  onTextFontAssetChange?: (assetId: string) => void;
  onTextSizeChange?: (size: number) => void;
  onTextFillChange?: (fill: string) => void;
  onTextFillPaintChange?: (fill: TextPaint) => void;
  onTextFillEnabledChange?: (enabled: boolean) => void;
  onTextStrokeColorChange?: (stroke: string) => void;
  onTextStrokeWidthChange?: (width: number) => void;
  onTextAlignmentChange?: (alignment: EditorSession['text']['alignment']) => void;
  onTextPropertyBegin?: () => void;
  onTextPropertyCommit?: () => void;
  onTextPropertyCancel?: () => void;
  onTextLayoutModeChange?: (mode: 'point' | 'paragraph') => void;
  onSelectedVectorStyleChange: (change: Partial<EditorSession['vectorStyle']>) => void;
  onSelectedShapeChange: (change: Partial<EditorSession['shape']>) => void;
  onWarpReset: () => void;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onSelectionCombineModeChange: (mode: EditorSession['selectionCombineMode']) => void;
  onSelectionRowHeightChange: (height: number) => void;
  onSelectionColumnWidthChange: (width: number) => void;
  onZoomPreset: (percent: number) => void;
  onZoomFit: () => void;
  onToolChange: (tool: ToolId) => void;
  onForegroundColorChange: (color: string) => void;
  onBackgroundColorChange: (color: string) => void;
  onSwapColors: () => void;
  onResetColors: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  advancedFileInputRef: RefObject<HTMLInputElement | null>;
  fastFileAccept: string;
  precisionFileAccept: string;
  onFastFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPrecisionFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  children: React.ReactNode;
  overlays?: React.ReactNode;
}

/**
 * Platform-neutral editor chrome.
 *
 * This component owns presentation and event containment only. It deliberately
 * receives commands and projected state instead of document, history, renderer
 * or host services, keeping web and Electron on the same UI boundary.
 */
export const LightTableEditorShell: React.FC<LightTableEditorShellProps> = ({
  screenMode,
  active,
  saving,
  onClose,
  menuOptionsFor,
  activeTool,
  brush,
  gradient,
  shape,
  warp,
  vectorStyle,
  text,
  textFonts,
  textProperties,
  textLayoutMode,
  selectedVectorStyle,
  selectedShape,
  selectedShapeKind,
  selectionPixelSnap,
  selectionCombineMode,
  selectionRowHeight,
  selectionColumnWidth,
  zoomPercent,
  onBrushChange,
  onGradientChange,
  onShapeChange,
  onWarpChange,
  onVectorStyleChange,
  onTextChange,
  onTextFontAssetChange,
  onTextSizeChange,
  onTextFillChange,
  onTextFillPaintChange,
  onTextFillEnabledChange,
  onTextStrokeColorChange,
  onTextStrokeWidthChange,
  onTextAlignmentChange,
  onTextPropertyBegin,
  onTextPropertyCommit,
  onTextPropertyCancel,
  onTextLayoutModeChange,
  onSelectedVectorStyleChange,
  onSelectedShapeChange,
  onWarpReset,
  onSelectionPixelSnapChange,
  onSelectionCombineModeChange,
  onSelectionRowHeightChange,
  onSelectionColumnWidthChange,
  onZoomPreset,
  onZoomFit,
  onToolChange,
  onForegroundColorChange,
  onBackgroundColorChange,
  onSwapColors,
  onResetColors,
  fileInputRef,
  advancedFileInputRef,
  fastFileAccept,
  precisionFileAccept,
  onFastFileChange,
  onPrecisionFileChange,
  children,
  overlays
}) => (
  <div
    className={`modal-backdrop lighttable-backdrop${active ? '' : ' lighttable-backdrop--inactive'}`}
    aria-hidden={!active}
  >
    <div
      className={`modal lighttable${screenMode === 'canvas-only' ? ' lighttable--canvas-only' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      {screenMode !== 'canvas-only' ? <div className="modal__header concept-art-editor__header lighttable__header">
        <div className="lighttable__header-left">
          <EditorMenuBar optionsFor={menuOptionsFor} />
        </div>
        <SquareIconButton
          className="lighttable__close-button"
          onClick={onClose}
          disabled={saving}
          title="Close editor"
          aria-label="Close editor"
          icon={<img src={lightTableIcon('close.png')} alt="" aria-hidden />}
        />
      </div> : null}

      {screenMode !== 'canvas-only' ? <ToolOptionsBar
        activeTool={activeTool}
        brush={brush}
        gradient={gradient}
        shape={shape}
        warp={warp}
        vectorStyle={vectorStyle}
        text={text}
        textFonts={textFonts}
        textProperties={textProperties}
        textLayoutMode={textLayoutMode}
        selectedVectorStyle={selectedVectorStyle}
        selectedShape={selectedShape}
        selectedShapeKind={selectedShapeKind}
        selectionPixelSnap={selectionPixelSnap}
        selectionCombineMode={selectionCombineMode}
        selectionRowHeight={selectionRowHeight}
        selectionColumnWidth={selectionColumnWidth}
        zoomPercent={zoomPercent}
        onBrushChange={onBrushChange}
        onGradientChange={onGradientChange}
        onShapeChange={onShapeChange}
        onWarpChange={onWarpChange}
        onVectorStyleChange={onVectorStyleChange}
        onTextChange={onTextChange}
        onTextFontAssetChange={onTextFontAssetChange}
        onTextSizeChange={onTextSizeChange}
        onTextFillChange={onTextFillChange}
        onTextFillPaintChange={onTextFillPaintChange}
        onTextFillEnabledChange={onTextFillEnabledChange}
        onTextStrokeColorChange={onTextStrokeColorChange}
        onTextStrokeWidthChange={onTextStrokeWidthChange}
        onTextAlignmentChange={onTextAlignmentChange}
        onTextPropertyBegin={onTextPropertyBegin}
        onTextPropertyCommit={onTextPropertyCommit}
        onTextPropertyCancel={onTextPropertyCancel}
        onTextLayoutModeChange={onTextLayoutModeChange}
        onSelectedVectorStyleChange={onSelectedVectorStyleChange}
        onSelectedShapeChange={onSelectedShapeChange}
        onWarpReset={onWarpReset}
        onSelectionPixelSnapChange={onSelectionPixelSnapChange}
        onSelectionCombineModeChange={onSelectionCombineModeChange}
        onSelectionRowHeightChange={onSelectionRowHeightChange}
        onSelectionColumnWidthChange={onSelectionColumnWidthChange}
        onZoomPreset={onZoomPreset}
        onZoomFit={onZoomFit}
      /> : null}

      <input
        ref={fileInputRef}
        type="file"
        accept={fastFileAccept}
        hidden
        onChange={onFastFileChange}
      />
      <input
        ref={advancedFileInputRef}
        type="file"
        accept={precisionFileAccept}
        hidden
        onChange={onPrecisionFileChange}
      />

      <div className="lighttable__body">
        {screenMode !== 'canvas-only' ? <EditorToolbar
          activeTool={activeTool}
          foregroundColor={brush.color}
          backgroundColor={brush.backgroundColor}
          onToolChange={onToolChange}
          onForegroundColorChange={onForegroundColorChange}
          onBackgroundColorChange={onBackgroundColorChange}
          onSwapColors={onSwapColors}
          onResetColors={onResetColors}
        /> : null}
        {children}
      </div>
    </div>
    {overlays}
  </div>
);
