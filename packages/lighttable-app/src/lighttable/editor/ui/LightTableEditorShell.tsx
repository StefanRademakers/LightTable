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
  active: boolean;
  saving: boolean;
  onClose: () => void;
  menuOptionsFor: (menuId: EditorMenuId) => Array<ContextMenuOption<string>>;
  activeTool: ToolId;
  brush: EditorSession['brush'];
  warp: EditorSession['warp'];
  selectionPixelSnap: boolean;
  zoomPercent: number;
  onBrushChange: (change: Partial<EditorSession['brush']>) => void;
  onWarpChange: (change: Partial<EditorSession['warp']>) => void;
  onWarpReset: () => void;
  onSelectionPixelSnapChange: (enabled: boolean) => void;
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
  active,
  saving,
  onClose,
  menuOptionsFor,
  activeTool,
  brush,
  warp,
  selectionPixelSnap,
  zoomPercent,
  onBrushChange,
  onWarpChange,
  onWarpReset,
  onSelectionPixelSnapChange,
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
      className="modal lighttable"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="modal__header concept-art-editor__header lighttable__header">
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
      </div>

      <ToolOptionsBar
        activeTool={activeTool}
        brush={brush}
        warp={warp}
        selectionPixelSnap={selectionPixelSnap}
        zoomPercent={zoomPercent}
        onBrushChange={onBrushChange}
        onWarpChange={onWarpChange}
        onWarpReset={onWarpReset}
        onSelectionPixelSnapChange={onSelectionPixelSnapChange}
        onZoomPreset={onZoomPreset}
        onZoomFit={onZoomFit}
      />

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
        <EditorToolbar
          activeTool={activeTool}
          foregroundColor={brush.color}
          backgroundColor={brush.backgroundColor}
          onToolChange={onToolChange}
          onForegroundColorChange={onForegroundColorChange}
          onBackgroundColorChange={onBackgroundColorChange}
          onSwapColors={onSwapColors}
          onResetColors={onResetColors}
        />
        {children}
      </div>
    </div>
    {overlays}
  </div>
);
