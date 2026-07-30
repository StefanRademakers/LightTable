import { describe, expect, it } from 'vitest';
import type { ToolId } from '../../editor/session/editorSession';
import {
  resolveEditorKeyboardCommand,
  type EditorKeyboardContext,
  type EditorKeyboardInput
} from './editorKeyboardRouter';

const input = (patch: Partial<EditorKeyboardInput>): EditorKeyboardInput => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...patch
});

const context = (patch: Partial<EditorKeyboardContext> = {}): EditorKeyboardContext => ({
  editable: false,
  saving: false,
  activeTool: 'view',
  hasActiveLayer: true,
  hasSelection: false,
  hasSelectionClipboard: false,
  transforming: false,
  ...patch
});

describe('resolveEditorKeyboardCommand', () => {
  it.each([
    [{ ctrlKey: true, key: 'z' }, 'undo'],
    [{ metaKey: true, shiftKey: true, key: 'z' }, 'redo'],
    [{ ctrlKey: true, key: 'd' }, 'select-none'],
    [{ metaKey: true, shiftKey: true, key: 'i' }, 'select-invert'],
    [{ altKey: true, key: 'Backspace' }, 'fill-foreground'],
    [{ metaKey: true, key: 'Delete' }, 'fill-background']
  ] as const)('normalizes %o to %s', (keys, expected) => {
    expect(resolveEditorKeyboardCommand(input(keys), context())).toBe(expected);
  });

  it('does not route document shortcuts from text editing controls', () => {
    expect(resolveEditorKeyboardCommand(
      input({ ctrlKey: true, key: 'a' }),
      context({ editable: true })
    )).toBeNull();
  });

  it('keeps history shortcuts available while an editor control has focus', () => {
    expect(resolveEditorKeyboardCommand(
      input({ ctrlKey: true, key: 'z' }),
      context({ editable: true })
    )).toBe('undo');
  });

  it('only exposes selection clipboard commands when their capabilities exist', () => {
    expect(resolveEditorKeyboardCommand(
      input({ ctrlKey: true, key: 'c' }),
      context()
    )).toBeNull();
    expect(resolveEditorKeyboardCommand(
      input({ ctrlKey: true, key: 'c' }),
      context({ hasSelection: true })
    )).toBe('selection-copy');
  });

  it.each([
    ['b', false, 'brush'],
    ['e', false, 'erase'],
    ['m', false, 'select-rectangle'],
    ['m', true, 'select-ellipse'],
    ['l', false, 'select-free']
  ] as const)('maps %s to the expected tool', (key, shiftKey, tool) => {
    expect(resolveEditorKeyboardCommand(
      input({ key, shiftKey }),
      context()
    )).toEqual({ type: 'activate-tool', tool: tool as ToolId });
  });
});
