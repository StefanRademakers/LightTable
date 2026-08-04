import type { ToolId } from '../../editor/session/editorSession';
import type { EditorKeyboardCommand } from './editorKeyboardRouter';

export interface EditorKeyboardCommandPorts {
  openFile(): void;
  saveFile(): void;
  quickExportPng(): void;
  isTransformActive(): boolean;
  commitTransform(): void;
  activateTool(tool: ToolId): void;
  undo(): void;
  redo(): void;
  beginTemporaryPan(): void;
  beginTemporaryZoom(direction: -1 | 1): void;
  beginTemporaryErase(): void;
  fillForeground(): void;
  fillBackground(): void;
  selectAll(): void;
  selectNone(): void;
  invertSelection(): void;
  copySelection(): void;
  copyMergedSelection(): void;
  pasteSelection(): void;
  layerViaCopy(): void;
  mergeDown(): void;
  invertActiveTarget(): void;
  openSelectionFeather(): void;
  swapColors(): void;
  resetColors(): void;
  toggleOriginal(): void;
  toggleScreenMode(): void;
  changeBrushSize(direction: -1 | 1): void;
  changeBrushHardness(direction: -1 | 1): void;
  openBrushSettings(): void;
  inputBrushPercent(target: 'opacity' | 'flow', digit: number): void;
  activateAdjacentDocument(direction: -1 | 1): void;
  closeActiveDocument(): void;
  changeZoom(direction: -1 | 1): void;
  fitZoom(): void;
  actualZoom(): void;
  cancelOrClose(): void;
}

/**
 * Executes one resolved keyboard intent through explicit document/UI ports.
 *
 * The resolver decides which intent a platform event represents; this
 * executor decides no document state itself and therefore cannot accidentally
 * route a command to another open document.
 */
export const executeEditorKeyboardCommand = (
  command: EditorKeyboardCommand,
  ports: EditorKeyboardCommandPorts
): void => {
  if (typeof command === 'object') {
    if (command.type === 'set-brush-percent') {
      ports.inputBrushPercent(command.target, command.digit);
      return;
    }
    if (ports.isTransformActive() && command.tool !== 'transform') {
      ports.commitTransform();
    }
    ports.activateTool(command.tool);
    return;
  }

  switch (command) {
    case 'open-file':
      ports.openFile();
      return;
    case 'save-file':
      ports.saveFile();
      return;
    case 'quick-export-png':
      ports.quickExportPng();
      return;
    case 'undo':
      ports.undo();
      return;
    case 'redo':
      ports.redo();
      return;
    case 'temporary-pan-start':
      ports.beginTemporaryPan();
      return;
    case 'temporary-zoom-in-start':
      ports.beginTemporaryZoom(1);
      return;
    case 'temporary-zoom-out-start':
      ports.beginTemporaryZoom(-1);
      return;
    case 'temporary-erase-start':
      ports.beginTemporaryErase();
      return;
    case 'fill-foreground':
      ports.fillForeground();
      return;
    case 'fill-background':
      ports.fillBackground();
      return;
    case 'select-all':
      ports.selectAll();
      return;
    case 'select-none':
      ports.selectNone();
      return;
    case 'select-invert':
      ports.invertSelection();
      return;
    case 'selection-copy':
      ports.copySelection();
      return;
    case 'selection-copy-merged':
      ports.copyMergedSelection();
      return;
    case 'selection-paste':
      ports.pasteSelection();
      return;
    case 'layer-via-copy':
      ports.layerViaCopy();
      return;
    case 'merge-down':
      ports.mergeDown();
      return;
    case 'free-transform':
      ports.activateTool('transform');
      return;
    case 'invert-active-target':
      ports.invertActiveTarget();
      return;
    case 'selection-feather':
      ports.openSelectionFeather();
      return;
    case 'swap-colors':
      ports.swapColors();
      return;
    case 'reset-colors':
      ports.resetColors();
      return;
    case 'toggle-original':
      ports.toggleOriginal();
      return;
    case 'toggle-screen-mode':
      ports.toggleScreenMode();
      return;
    case 'brush-size-decrease':
      ports.changeBrushSize(-1);
      return;
    case 'brush-size-increase':
      ports.changeBrushSize(1);
      return;
    case 'brush-hardness-decrease':
      ports.changeBrushHardness(-1);
      return;
    case 'brush-hardness-increase':
      ports.changeBrushHardness(1);
      return;
    case 'open-brush-settings':
      ports.openBrushSettings();
      return;
    case 'commit-transform':
      ports.commitTransform();
      return;
    case 'activate-next-document':
      ports.activateAdjacentDocument(1);
      return;
    case 'activate-previous-document':
      ports.activateAdjacentDocument(-1);
      return;
    case 'close-active-document':
      ports.closeActiveDocument();
      return;
    case 'zoom-in':
      ports.changeZoom(1);
      return;
    case 'zoom-out':
      ports.changeZoom(-1);
      return;
    case 'zoom-fit':
      ports.fitZoom();
      return;
    case 'zoom-actual':
      ports.actualZoom();
      return;
    case 'suppress-tab-navigation':
      return;
    case 'cancel-or-close':
      ports.cancelOrClose();
  }
};
