import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_KEYMAP,
  editorKeyChordMatches,
  findEditorKeymapConflicts,
  resolveEditorKeymapCommand,
  type EditorKeyboardContext,
  type EditorKeyboardInput,
  type EditorKeymap
} from './editorKeymap';

const input = (
  patch: Partial<EditorKeyboardInput> = {}
): EditorKeyboardInput => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...patch
});

const context = (
  patch: Partial<EditorKeyboardContext> = {}
): EditorKeyboardContext => ({
  editable: false,
  saving: false,
  activeTool: 'view',
  hasActiveLayer: true,
  hasSelection: false,
  hasSelectionClipboard: false,
  transforming: false,
  ...patch
});

describe('editor keymap', () => {
  it('keeps the default keymap free from exact chord conflicts', () => {
    expect([...findEditorKeymapConflicts(DEFAULT_EDITOR_KEYMAP)]).toEqual([]);
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true }
  ])('normalizes the platform primary modifier for $ctrlKey/$metaKey', (modifiers) => {
    expect(editorKeyChordMatches(
      { key: 'z', primary: true, alt: false, shift: false },
      input({ key: 'Z', ...modifiers })
    )).toBe(true);
  });

  it('uses physical bracket codes for brush size on keyboard layouts that alter key', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Dead', code: 'BracketLeft' }),
      context({ activeTool: 'brush' })
    )).toBe('brush-size-decrease');
  });

  it('normalizes physical browser-zoom keys across main and numeric keyboards', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: '=', code: 'Equal', ctrlKey: true }),
      context({ editable: true })
    )).toBe('zoom-in');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Subtract', code: 'NumpadSubtract', metaKey: true }),
      context()
    )).toBe('zoom-out');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Insert', code: 'Numpad0', ctrlKey: true }),
      context()
    )).toBe('zoom-fit');
  });

  it('preserves modifier-specific tool bindings', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'm' }),
      context()
    )).toEqual({ type: 'activate-tool', tool: 'select-rectangle' });
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'm', shiftKey: true }),
      context()
    )).toEqual({ type: 'activate-tool', tool: 'select-ellipse' });
  });

  it('allows profiles to remap commands without changing command execution', () => {
    const customKeymap: EditorKeymap = {
      id: 'custom',
      name: 'Custom',
      bindings: [{
        id: 'history.undo',
        chord: { key: 'u', primary: true, alt: false, shift: false },
        resolve: () => 'undo'
      }]
    };

    expect(resolveEditorKeymapCommand(
      customKeymap,
      input({ key: 'u', ctrlKey: true }),
      context()
    )).toBe('undo');
    expect(resolveEditorKeymapCommand(
      customKeymap,
      input({ key: 'z', ctrlKey: true }),
      context()
    )).toBeNull();
  });

  it('only resolves explicitly permitted commands while editing text', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'z', ctrlKey: true }),
      context({ editable: true })
    )).toBe('undo');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'a', ctrlKey: true }),
      context({ editable: true })
    )).toBeNull();
  });
});
