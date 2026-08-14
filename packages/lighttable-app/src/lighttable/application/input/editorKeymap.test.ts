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

  it.each([
    { key: 'o', command: 'open-file' },
    { key: 's', command: 'save-file' }
  ])('routes primary+$key to $command even while editing', ({ key, command }) => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true }),
      context({ editable: true })
    )).toBe(command);
  });

  it('routes primary+shift+S to Quick Export PNG', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 's', code: 'KeyS', metaKey: true, shiftKey: true }),
      context({ editable: true })
    )).toBe('quick-export-png');
  });

  it('routes Photoshop Image Size without requiring an active layer', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'i', code: 'KeyI', ctrlKey: true, altKey: true }),
      context({ hasActiveLayer: false, editable: true })
    )).toBe('open-image-size');
  });

  it('routes Photoshop-compatible view overlay shortcuts', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'h', code: 'KeyH', ctrlKey: true }),
      context()
    )).toBe('toggle-extras');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'r', code: 'KeyR', metaKey: true }),
      context()
    )).toBe('toggle-rulers');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: ':', code: 'Semicolon', ctrlKey: true, shiftKey: true }),
      context()
    )).toBe('toggle-snap');
  });

  it('routes Photoshop-compatible primary+T to Free Transform', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 't', code: 'KeyT', ctrlKey: true }),
      context({ hasActiveLayer: true })
    )).toBe('free-transform');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 't', code: 'KeyT', ctrlKey: true, altKey: true }),
      context({ hasActiveLayer: true })
    )).toBeNull();
  });

  it('routes Photoshop-compatible repeat transform chords', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 't', code: 'KeyT', ctrlKey: true, shiftKey: true }),
      context({ hasActiveLayer: true })
    )).toBe('repeat-transform');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 't', code: 'KeyT', ctrlKey: true, altKey: true, shiftKey: true }),
      context({ hasActiveLayer: true })
    )).toBe('repeat-transform-duplicate');
  });

  it('finishes an active Pen path with Enter', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Enter', code: 'Enter' }),
      context({ activeTool: 'vector-pen' })
    )).toBe('commit-active-operation');
  });

  it('uses physical bracket codes for brush size on keyboard layouts that alter key', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Dead', code: 'BracketLeft' }),
      context({ activeTool: 'brush' })
    )).toBe('brush-size-decrease');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Dead', code: 'BracketRight' }),
      context({ activeTool: 'warp' })
    )).toBe('brush-size-increase');
  });

  it('uses shifted brackets for brush hardness', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: '{', code: 'BracketLeft', shiftKey: true }),
      context({ activeTool: 'brush' })
    )).toBe('brush-hardness-decrease');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: '}', code: 'BracketRight', shiftKey: true }),
      context({ activeTool: 'erase' })
    )).toBe('brush-hardness-increase');
  });

  it('routes Photoshop-style paint controls only for brush-capable tools', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: '`', code: 'Backquote' }),
      context({ activeTool: 'brush' })
    )).toBe('temporary-erase-start');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: '5', code: 'Digit5' }),
      context({ activeTool: 'erase' })
    )).toEqual({ type: 'set-brush-percent', target: 'opacity', digit: 5 });
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: '5', code: 'Digit5', shiftKey: true }),
      context({ activeTool: 'warp' })
    )).toEqual({ type: 'set-brush-percent', target: 'flow', digit: 5 });
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: '`', code: 'Backquote' }),
      context({ activeTool: 'view' })
    )).toBeNull();
  });

  it('resets and swaps the editor colors with D and X', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'd', code: 'KeyD' }),
      context()
    )).toBe('reset-colors');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'x', code: 'KeyX' }),
      context()
    )).toBe('swap-colors');
  });

  it('nudges selection outlines and active transforms by one or ten pixels', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'ArrowLeft', code: 'ArrowLeft' }),
      context({ activeTool: 'select-rectangle', hasSelection: true })
    )).toEqual({ type: 'nudge', x: -1, y: 0 });
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'ArrowDown', code: 'ArrowDown', shiftKey: true }),
      context({ activeTool: 'transform', hasSelection: false, transforming: true })
    )).toEqual({ type: 'nudge', x: 0, y: 10 });
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'ArrowRight', code: 'ArrowRight' }),
      context({ activeTool: 'transform', hasSelection: false, transforming: false })
    )).toBeNull();
  });

  it('supports Fill shortcuts with a transient preserve-transparency modifier', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Backspace', code: 'Backspace', altKey: true }),
      context()
    )).toBe('fill-foreground');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Backspace', code: 'Backspace', altKey: true, shiftKey: true }),
      context()
    )).toBe('fill-foreground-preserve');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'Backspace', code: 'Backspace', ctrlKey: true, shiftKey: true }),
      context()
    )).toBe('fill-background-preserve');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'F5', code: 'F5', shiftKey: true }),
      context()
    )).toBe('open-fill-dialog');
  });

  it('opens Brush settings with F5 only while Brush is active', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'F5', code: 'F5' }),
      context({ activeTool: 'brush' })
    )).toBe('open-brush-settings');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'F5', code: 'F5' }),
      context({ activeTool: 'view' })
    )).toBeNull();
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
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'End', code: 'Numpad1', ctrlKey: true }),
      context({ editable: true })
    )).toBe('zoom-actual');
  });

  it('routes modifier-space temporary zoom without stealing plain pan', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: ' ', code: 'Space', ctrlKey: true }),
      context()
    )).toBe('temporary-zoom-in-start');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: ' ', code: 'Space', altKey: true }),
      context()
    )).toBe('temporary-zoom-out-start');
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: ' ', code: 'Space' }),
      context()
    )).toBe('temporary-pan-start');
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

  it('activates and cycles the grouped text tools with T', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 't', code: 'KeyT' }),
      context()
    )).toEqual({ type: 'activate-tool', tool: 'text-point' });
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 't', code: 'KeyT', shiftKey: true }),
      context({ activeTool: 'text-point' })
    )).toEqual({ type: 'activate-tool', tool: 'text-vertical' });
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 't', code: 'KeyT' }),
      context({ activeTool: 'text-paragraph' })
    )).toEqual({ type: 'activate-tool', tool: 'text-point' });
  });

  it('routes plain F to the workspace screen-mode command', () => {
    expect(resolveEditorKeymapCommand(
      DEFAULT_EDITOR_KEYMAP,
      input({ key: 'f', code: 'KeyF' }),
      context()
    )).toBe('toggle-screen-mode');
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
