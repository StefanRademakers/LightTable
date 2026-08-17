import type { ToolId } from '../../editor/session/editorSession';
import type { EditorKeyboardCommand } from './editorKeyboardRouter';

export interface EditorKeyboardCommandPorts {
  openFile(): void;
  saveFile(): void;
  quickExportPng(): void;
  openImageSize(): void;
  applyCurves(): void;
  isTransformActive(): boolean;
  commitTransform(): void;
  repeatTransform(duplicate?: boolean): void;
  commitActiveOperation(): void;
  activateTool(tool: ToolId): void;
  undo(): void;
  undoPenAnchor(): boolean;
  redo(): void;
  beginTemporaryPan(): void;
  beginTemporaryZoom(direction: -1 | 1): void;
  beginTemporaryErase(): void;
  fillForeground(preserveTransparency?: boolean): void;
  fillBackground(preserveTransparency?: boolean): void;
  openFillDialog(): void;
  deleteActiveTarget(): void;
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
  toggleExtras(): void;
  toggleRulers(): void;
  toggleSnap(): void;
  toggleScreenMode(): void;
  changeBrushSize(direction: -1 | 1): void;
  changeBrushHardness(direction: -1 | 1): void;
  openBrushSettings(): void;
  inputBrushPercent(target: 'opacity' | 'flow', digit: number): void;
  nudge(x: number, y: number): void;
  activateAdjacentDocument(direction: -1 | 1): void;
  closeActiveDocument(): void;
  changeZoom(direction: -1 | 1): void;
  fitZoom(): void;
  actualZoom(): void;
  cancelActiveOperation(): void;
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
    if (command.type === 'nudge') {
      ports.nudge(command.x, command.y);
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
    case 'open-image-size':
      ports.openImageSize();
      return;
    case 'apply-curves':
      ports.applyCurves();
      return;
    case 'undo':
      if (!ports.undoPenAnchor()) ports.undo();
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
    case 'fill-foreground-preserve':
      ports.fillForeground(true);
      return;
    case 'fill-background-preserve':
      ports.fillBackground(true);
      return;
    case 'open-fill-dialog':
      ports.openFillDialog();
      return;
    case 'delete-active-target':
      ports.deleteActiveTarget();
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
    case 'repeat-transform':
      ports.repeatTransform(false);
      return;
    case 'repeat-transform-duplicate':
      ports.repeatTransform(true);
      return;
    case 'commit-active-operation':
      ports.commitActiveOperation();
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
    case 'toggle-extras':
      ports.toggleExtras();
      return;
    case 'toggle-rulers':
      ports.toggleRulers();
      return;
    case 'toggle-snap':
      ports.toggleSnap();
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
    case 'cancel-active-operation':
      ports.cancelActiveOperation();
  }
};
