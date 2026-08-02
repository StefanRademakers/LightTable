import React, { type ChangeEvent, type RefObject } from 'react';
import { SquareIconButton } from '../../../ui/SquareIconButton';
import type { ContextMenuOption } from '../../../ui/ContextMenu';
import { lightTableIcon } from '../../../assets/icons';
import type { EditorMenuId } from '../menus/createEditorMenuOptions';
import type { EditorSession, ToolId } from '../session/editorSession';
import { EditorMenuBar } from './EditorMenuBar';
import { EditorToolbar } from './EditorToolbar';
import { ToolOptionsBar } from './ToolOptionsBar';

export interface LightTableEditorShellProps {
  screenMode: 'normal' | 'canvas-only';
  active: boolean;
  saving: boolean;
  onClose: () => void;
  menuOptionsFor: (menuId: EditorMenuId) => Array<ContextMenuOption<string>>;
  activeTool: ToolId;
  brush: EditorSession['brush'];
  warp: EditorSession['warp'];
  vectorStyle: EditorSession['vectorStyle'];
  selectedVectorStyle: EditorSession['vectorStyle'] | null;
  selectionPixelSnap: boolean;
  selectionCombineMode: EditorSession['selectionCombineMode'];
  zoomPercent: number;
  onBrushChange: (change: Partial<EditorSession['brush']>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onVectorStyleChange: (change: Partial<EditorSession['vectorStyle']>) => void;
  onSelectedVectorStyleChange: (change: Partial<EditorSession['vectorStyle']>) => void;
  onWarpReset: () => void;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
  onSelectionCombineModeChange: (mode: EditorSession['selectionCombineMode']) => void;
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
  warp,
  vectorStyle,
  selectedVectorStyle,
  selectionPixelSnap,
  selectionCombineMode,
  zoomPercent,
  onBrushChange,
  onWarpChange,
  onVectorStyleChange,
  onSelectedVectorStyleChange,
  onWarpReset,
  onSelectionPixelSnapChange,
  onSelectionCombineModeChange,
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
    onClick={(event) => {
      // Portalled menus still bubble through this React tree. Only a direct
      // backdrop click is a close request.
      if (event.target === event.currentTarget && !saving) onClose();
    }}
  >
    <div
      className={`modal lighttable${screenMode === 'canvas-only' ? ' lighttable--canvas-only' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      {screenMode === 'normal' ? <div className="modal__header concept-art-editor__header lighttable__header">
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

      {screenMode === 'normal' ? <ToolOptionsBar
        activeTool={activeTool}
        brush={brush}
        warp={warp}
        vectorStyle={vectorStyle}
        selectedVectorStyle={selectedVectorStyle}
        selectionPixelSnap={selectionPixelSnap}
        selectionCombineMode={selectionCombineMode}
        zoomPercent={zoomPercent}
        onBrushChange={onBrushChange}
        onWarpChange={onWarpChange}
        onVectorStyleChange={onVectorStyleChange}
        onSelectedVectorStyleChange={onSelectedVectorStyleChange}
        onWarpReset={onWarpReset}
        onSelectionPixelSnapChange={onSelectionPixelSnapChange}
        onSelectionCombineModeChange={onSelectionCombineModeChange}
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
        {screenMode === 'normal' ? <EditorToolbar
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
