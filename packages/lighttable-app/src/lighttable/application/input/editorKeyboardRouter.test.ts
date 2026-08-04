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
    [{ ctrlKey: true, key: 'e' }, 'merge-down'],
    [{ metaKey: true, key: 'e' }, 'merge-down'],
    [{ metaKey: true, key: 'Tab' }, 'activate-next-document'],
    [{ ctrlKey: true, shiftKey: true, key: 'Tab' }, 'activate-previous-document'],
    [{ ctrlKey: true, key: 'w' }, 'close-active-document'],
    [{ metaKey: true, key: 'F4' }, 'close-active-document'],
    [{ ctrlKey: true, key: '+', code: 'Equal' }, 'zoom-in'],
    [{ metaKey: true, key: '-', code: 'Minus' }, 'zoom-out'],
    [{ ctrlKey: true, key: '0', code: 'Digit0' }, 'zoom-fit'],
    [{ ctrlKey: true, key: '1', code: 'Digit1' }, 'zoom-actual'],
    [{ ctrlKey: true, key: ' ', code: 'Space' }, 'temporary-zoom-in-start'],
    [{ altKey: true, key: ' ', code: 'Space' }, 'temporary-zoom-out-start'],
    [{ key: 'Tab' }, 'suppress-tab-navigation'],
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
    expect(resolveEditorKeyboardCommand(
      input({ metaKey: true, shiftKey: true, key: 'c' }),
      context({ hasSelection: true })
    )).toBe('selection-copy-merged');
    expect(resolveEditorKeyboardCommand(
      input({ ctrlKey: true, key: 'v' }),
      context({ hasSelectionClipboard: false })
    )).toBe('selection-paste');
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

  it('cycles vector tool families from the active family member', () => {
    expect(resolveEditorKeyboardCommand(
      input({ key: 'a' }),
      context({ activeTool: 'vector-select' })
    )).toEqual({ type: 'activate-tool', tool: 'vector-direct-select' });
    expect(resolveEditorKeyboardCommand(
      input({ key: 'u' }),
      context({ activeTool: 'shape-ellipse' })
    )).toEqual({ type: 'activate-tool', tool: 'shape-triangle' });
    expect(resolveEditorKeyboardCommand(
      input({ key: 'p', shiftKey: true }),
      context({ activeTool: 'vector-pen' })
    )).toEqual({ type: 'activate-tool', tool: 'vector-convert-anchor' });
  });
});
