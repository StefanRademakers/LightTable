import type { ToolId } from '../../editor/session/editorSession';

export interface EditorKeyboardInput {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export interface EditorKeyboardContext {
  readonly editable: boolean;
  readonly saving: boolean;
  readonly activeTool: ToolId;
  readonly hasActiveLayer: boolean;
  readonly hasSelection: boolean;
  readonly hasSelectionClipboard: boolean;
  readonly transforming: boolean;
}

export type EditorKeyboardCommand =
  | 'undo'
  | 'redo'
  | 'temporary-pan-start'
  | 'fill-foreground'
  | 'fill-background'
  | 'select-all'
  | 'select-none'
  | 'select-invert'
  | 'selection-copy'
  | 'selection-paste'
  | 'layer-via-copy'
  | 'free-transform'
  | 'invert-active-target'
  | 'selection-feather'
  | 'swap-colors'
  | 'toggle-original'
  | 'brush-size-decrease'
  | 'brush-size-increase'
  | 'commit-transform'
  | 'cancel-or-close'
  | { readonly type: 'activate-tool'; readonly tool: ToolId };

const isPaintTool = (tool: ToolId) => tool === 'brush' || tool === 'erase';

/**
 * Converts platform keyboard input into editor intent without touching React,
 * DOM state, a document or the renderer. Command execution remains explicitly
 * document-scoped in the composition layer.
 */
export const resolveEditorKeyboardCommand = (
  input: EditorKeyboardInput,
  context: EditorKeyboardContext
): EditorKeyboardCommand | null => {
  const key = input.key.toLowerCase();
  const primary = input.ctrlKey || input.metaKey;

  if (primary && !input.altKey && !input.shiftKey && key === 'z') return 'undo';
  if (
    primary
    && !input.altKey
    && ((input.shiftKey && key === 'z') || (!input.shiftKey && key === 'y'))
  ) {
    return 'redo';
  }
  if (input.code === 'Space' && !context.editable && !primary && !input.altKey) {
    return 'temporary-pan-start';
  }

  if (context.editable) return null;
  const deleteKey = input.key === 'Backspace' || input.key === 'Delete';
  if (deleteKey && input.altKey && !primary && !input.shiftKey) return 'fill-foreground';
  if (deleteKey && primary && !input.altKey && !input.shiftKey) return 'fill-background';
  if (primary && !input.altKey && !input.shiftKey && key === 'a') return 'select-all';
  if (primary && !input.altKey && !input.shiftKey && key === 'd') return 'select-none';
  if (primary && !input.altKey && input.shiftKey && key === 'i') return 'select-invert';
  if (primary && !input.altKey && !input.shiftKey && key === 'c' && context.hasSelection) {
    return 'selection-copy';
  }
  if (
    primary
    && !input.altKey
    && !input.shiftKey
    && key === 'v'
    && context.hasSelectionClipboard
  ) {
    return 'selection-paste';
  }
  if (primary && !input.altKey && !input.shiftKey && key === 'j' && !context.saving) {
    return 'layer-via-copy';
  }
  if (
    primary
    && input.altKey
    && !input.shiftKey
    && key === 't'
    && !context.saving
    && context.hasActiveLayer
  ) {
    return 'free-transform';
  }
  if (primary && !input.altKey && !input.shiftKey && key === 'i') {
    return 'invert-active-target';
  }
  if (!primary && !input.altKey && input.shiftKey && input.key === 'F6' && context.hasSelection) {
    return 'selection-feather';
  }
  if (!primary && !input.altKey && key === 'x') return 'swap-colors';
  if (!primary && !input.altKey && key === 'p') return 'toggle-original';

  if (!primary && !input.altKey && isPaintTool(context.activeTool)) {
    if (input.code === 'BracketLeft' || key === '[') return 'brush-size-decrease';
    if (input.code === 'BracketRight' || key === ']') return 'brush-size-increase';
  }

  const toolShortcuts: Partial<Record<string, ToolId>> = {
    h: 'view',
    t: 'transform',
    g: 'fill',
    b: 'brush',
    e: 'erase',
    m: input.shiftKey ? 'select-ellipse' : 'select-rectangle',
    l: 'select-free'
  };
  const tool = !primary && !input.altKey ? toolShortcuts[key] : undefined;
  if (tool) {
    return tool === 'transform' && context.activeTool === 'transform'
      ? 'commit-transform'
      : { type: 'activate-tool', tool };
  }
  if (input.key === 'Enter' && context.transforming) return 'commit-transform';
  if (input.key === 'Escape' && !context.saving) return 'cancel-or-close';
  return null;
};

export const isTemporaryPanRelease = (
  input: Pick<EditorKeyboardInput, 'code'>
): boolean => input.code === 'Space';
