import type { ToolId } from '../../editor/session/editorSession';
import type { EditorKeyboardCommand } from './editorKeyboardRouter';

export interface EditorKeyboardCommandPorts {
  isTransformActive(): boolean;
  commitTransform(): void;
  activateTool(tool: ToolId): void;
  undo(): void;
  redo(): void;
  beginTemporaryPan(): void;
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
  toggleOriginal(): void;
  changeBrushSize(direction: -1 | 1): void;
  activateAdjacentDocument(direction: -1 | 1): void;
  closeActiveDocument(): void;
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
    if (ports.isTransformActive() && command.tool !== 'transform') {
      ports.commitTransform();
    }
    ports.activateTool(command.tool);
    return;
  }

  switch (command) {
    case 'undo':
      ports.undo();
      return;
    case 'redo':
      ports.redo();
      return;
    case 'temporary-pan-start':
      ports.beginTemporaryPan();
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
    case 'toggle-original':
      ports.toggleOriginal();
      return;
    case 'brush-size-decrease':
      ports.changeBrushSize(-1);
      return;
    case 'brush-size-increase':
      ports.changeBrushSize(1);
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
    case 'suppress-tab-navigation':
      return;
    case 'cancel-or-close':
      ports.cancelOrClose();
  }
};
