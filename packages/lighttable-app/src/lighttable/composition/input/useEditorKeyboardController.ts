import type { EditorKeymap } from '../../application/input/editorKeymap';
import {
  isTemporaryPanRelease,
  isTemporaryEraseRelease,
  isTemporaryZoomRelease,
  resolveEditorKeyboardCommand
} from '../../application/input/editorKeyboardRouter';
import {
  executeEditorKeyboardCommand,
  type EditorKeyboardCommandPorts
} from '../../application/input/executeEditorKeyboardCommand';
import { useEditorWindowInput } from '../../editor/hooks/useEditorWindowInput';
import type { ToolId } from '../../editor/session/editorSession';

export interface EditorKeyboardControllerContext {
  readonly saving: boolean;
  readonly activeTool: ToolId;
  readonly hasActiveLayer: boolean;
  readonly hasSelection: boolean;
  readonly hasSelectionClipboard: boolean;
  readonly transforming: boolean;
}

export interface EditorKeyboardControllerOptions {
  readonly enabled: boolean;
  readonly getContext: () => EditorKeyboardControllerContext;
  readonly commands: EditorKeyboardCommandPorts;
  readonly keymap?: EditorKeymap;
  readonly temporaryPanActive: () => boolean;
  readonly releaseTemporaryPan: () => void;
  readonly temporaryZoomActive: () => boolean;
  readonly releaseTemporaryZoom: () => void;
  readonly temporaryEraseActive: () => boolean;
  readonly releaseTemporaryErase: () => void;
  readonly clearTemporaryTool: () => void;
  readonly onShiftChange: (pressed: boolean) => void;
  readonly onAltChange: (pressed: boolean) => void;
  readonly onCapsLockChange: (active: boolean) => void;
}

const isTextEditingTarget = (target: EventTarget | null) => (
  target instanceof HTMLTextAreaElement
  || target instanceof HTMLSelectElement
  || (target instanceof HTMLInputElement && target.type !== 'range')
  || (target instanceof HTMLElement && target.isContentEditable)
);

/**
 * Binds the active document's keymap to the shared window input resource.
 *
 * Resolution, command execution and temporary-tool release remain separate
 * seams. A future preferences service can inject another EditorKeymap without
 * changing the editor root or document commands.
 */
export const useEditorKeyboardController = ({
  enabled,
  getContext,
  commands,
  keymap,
  temporaryPanActive,
  releaseTemporaryPan,
  temporaryZoomActive,
  releaseTemporaryZoom,
  temporaryEraseActive,
  releaseTemporaryErase,
  clearTemporaryTool,
  onShiftChange,
  onAltChange,
  onCapsLockChange
}: EditorKeyboardControllerOptions): void => {
  useEditorWindowInput(enabled, {
    onKeyDown: (event) => {
      if (
        event.key === 'Tab'
        && event.target instanceof HTMLElement
        && event.target.closest('[data-editor-native-tab-navigation]')
      ) return false;
      const command = resolveEditorKeyboardCommand(event, {
        ...getContext(),
        editable: isTextEditingTarget(event.target)
      }, keymap);
      if (!command) return false;
      executeEditorKeyboardCommand(command, commands);
      return true;
    },
    onKeyUp: (event) => {
      if (isTemporaryPanRelease(event) && temporaryPanActive()) {
        releaseTemporaryPan();
        return true;
      }
      if (isTemporaryZoomRelease(event) && temporaryZoomActive()) {
        releaseTemporaryZoom();
        return true;
      }
      if (isTemporaryEraseRelease(event) && temporaryEraseActive()) {
        releaseTemporaryErase();
        return true;
      }
      return false;
    },
    onShiftChange,
    onAltChange,
    onCapsLockChange,
    onBlur: clearTemporaryTool
  });
};
