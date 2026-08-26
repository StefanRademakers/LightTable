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
  readonly documentKind?: 'image' | 'video' | 'model-3d';
  readonly saving: boolean;
  readonly activeTool: ToolId;
  readonly hasActiveLayer: boolean;
  readonly hasSelection: boolean;
  readonly hasSelectionClipboard: boolean;
  readonly transforming: boolean;
  readonly editingBlocked: boolean;
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

const isFloatingControlTarget = (target: EventTarget | null) => (
  target instanceof HTMLElement
  && Boolean(target.closest('[data-editor-floating-control]'))
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
    onKeyDown: (event, physicalModifiers) => {
      if (event.target instanceof HTMLElement) {
        const nativeScope = event.target.closest<HTMLElement>('[data-editor-native-tab-navigation]');
        if (nativeScope && (nativeScope.dataset.editorNativeTabNavigation !== 'tab-only'
          || event.key === 'Tab')) return false;
      }
      const context = getContext();
      const command = resolveEditorKeyboardCommand({
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey || physicalModifiers.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey || physicalModifiers.altKey,
        shiftKey: event.shiftKey
      }, {
        ...context,
        // Popovers and color/gradient controls own Enter, Escape and arrows.
        // Treat them like an editing scope so application shortcuts explicitly
        // admitted while editing may still work, while canvas operations cannot
        // leak through a portal into the active tool transaction.
        editable: isTextEditingTarget(event.target) || isFloatingControlTarget(event.target)
      }, keymap);
      if (!command) return false;
      if (context.editingBlocked) return true;
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
