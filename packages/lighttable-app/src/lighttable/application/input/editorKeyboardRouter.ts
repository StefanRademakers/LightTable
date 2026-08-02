import {
  DEFAULT_EDITOR_KEYMAP,
  resolveEditorKeymapCommand,
  type EditorKeyboardCommand,
  type EditorKeyboardContext,
  type EditorKeyboardInput,
  type EditorKeymap
} from './editorKeymap';

export type {
  EditorKeyboardCommand,
  EditorKeyboardContext,
  EditorKeyboardInput
} from './editorKeymap';

/**
 * Converts platform keyboard input into editor intent without touching React,
 * DOM state, a document or the renderer. Command execution remains explicitly
 * document-scoped in the composition layer.
 */
export const resolveEditorKeyboardCommand = (
  input: EditorKeyboardInput,
  context: EditorKeyboardContext,
  keymap: EditorKeymap = DEFAULT_EDITOR_KEYMAP
): EditorKeyboardCommand | null =>
  resolveEditorKeymapCommand(keymap, input, context);

export const isTemporaryPanRelease = (
  input: Pick<EditorKeyboardInput, 'code'>
): boolean => input.code === 'Space';

export const isTemporaryEraseRelease = (
  input: Pick<EditorKeyboardInput, 'code'>
): boolean => input.code === 'Backquote';
