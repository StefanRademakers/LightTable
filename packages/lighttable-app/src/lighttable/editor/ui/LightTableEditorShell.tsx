import React, { type ChangeEvent, type RefObject } from 'react';
import { EditorChrome, EditorChromeBody, EditorChromeHeader, IconButton, type MenuOption } from '@lighttable/ui';
import { lightTableIcon } from '../../../assets/icons';
import type { EditorMenuId } from '../menus/createEditorMenuOptions';
import type { EditorSession, ToolId } from '../session/editorSession';
import { EditorMenuBar } from './EditorMenuBar';
import { EditorToolbar } from './EditorToolbar';
import { EmptyToolOptionsBar, ToolOptionsBar, type ToolOptionsProps } from './ToolOptionsBar';
import type { EditorScreenMode } from '../workspace/editorScreenMode';

export interface LightTableEditorShellProps {
  workspaceDocumentKind?: 'image' | 'video' | 'model-3d';
  screenMode: EditorScreenMode;
  active: boolean;
  saving: boolean;
  recoveryNotice?: string | null;
  projectName?: string;
  onRevealProject?: () => void;
  onClose: () => void;
  menuOptionsFor: (menuId: EditorMenuId) => Array<MenuOption<string>>;
  activeTool: ToolId;
  brush: EditorSession['brush'];
  toolOptions: ToolOptionsProps;
  onZoomActual: () => void;
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

const IMAGE_ONLY_MENUS = new Set<EditorMenuId>(['image', 'layer', 'type', 'select', 'filter']);

export const editorMenuEnabledForDocumentKind = (
  documentKind: 'image' | 'video' | 'model-3d',
  menuId: EditorMenuId
): boolean => documentKind === 'image' || !IMAGE_ONLY_MENUS.has(menuId);

/**
 * Platform-neutral editor chrome.
 *
 * This component owns presentation and event containment only. It deliberately
 * receives commands and projected state instead of document, history, renderer
 * or host services, keeping web and Electron on the same UI boundary.
 */
export const LightTableEditorShell: React.FC<LightTableEditorShellProps> = ({
  workspaceDocumentKind = 'image',
  screenMode,
  active,
  saving,
  recoveryNotice,
  projectName,
  onRevealProject,
  onClose,
  menuOptionsFor,
  activeTool,
  brush,
  toolOptions,
  onZoomActual,
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
    <EditorChrome
      className={`lighttable${screenMode === 'canvas-only' ? ' lighttable--canvas-only' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      {screenMode !== 'canvas-only' ? <EditorChromeHeader className="modal__header concept-art-editor__header lighttable__header">
        <div className="lighttable__header-left">
          <EditorMenuBar optionsFor={menuOptionsFor} projectName={projectName}
            enabledFor={(menuId) => editorMenuEnabledForDocumentKind(workspaceDocumentKind, menuId)}
            onRevealProject={onRevealProject} />
        </div>
        <IconButton
          className="lighttable__close-button"
          onClick={onClose}
          disabled={saving}
          title="Close editor"
          aria-label="Close editor"
          icon={<img src={lightTableIcon('close.png')} alt="" aria-hidden />}
        />
      </EditorChromeHeader> : null}

      {screenMode !== 'canvas-only' && (
        workspaceDocumentKind === 'image'
        || (workspaceDocumentKind === 'video' && (activeTool === 'view' || activeTool === 'zoom'))
      ) ? <ToolOptionsBar {...toolOptions} /> : screenMode !== 'canvas-only' ? (
        <EmptyToolOptionsBar documentKind={workspaceDocumentKind} />
      ) : null}

      {recoveryNotice && screenMode !== 'canvas-only' ? (
        <div className="lighttable__recovery-notice" role="status">
          {recoveryNotice}
        </div>
      ) : null}

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

      <EditorChromeBody className="lighttable__body" data-canvas-only={screenMode === 'canvas-only' || undefined}>
        {screenMode !== 'canvas-only' ? <EditorToolbar
          documentKind={workspaceDocumentKind}
          activeTool={activeTool}
          foregroundColor={brush.color}
          backgroundColor={brush.backgroundColor}
          onToolChange={onToolChange}
          onZoomActual={onZoomActual}
          onForegroundColorChange={onForegroundColorChange}
          onBackgroundColorChange={onBackgroundColorChange}
          onSwapColors={onSwapColors}
          onResetColors={onResetColors}
        /> : null}
        {children}
      </EditorChromeBody>
    </EditorChrome>
    {overlays}
  </div>
);
