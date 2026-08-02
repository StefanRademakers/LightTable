import type { ToolId } from '../../editor/session/editorSession';
import { usesBrushSize } from '../../editor/tools/toolCapabilities';
import {
  TOOL_DEFINITIONS,
  TOOL_SHORTCUT_GROUPS,
  toolForShortcutCycle
} from '../../editor/tools/toolRegistry';

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
  | 'open-file'
  | 'save-file'
  | 'quick-export-png'
  | 'undo'
  | 'redo'
  | 'temporary-pan-start'
  | 'temporary-erase-start'
  | 'fill-foreground'
  | 'fill-background'
  | 'select-all'
  | 'select-none'
  | 'select-invert'
  | 'selection-copy'
  | 'selection-copy-merged'
  | 'selection-paste'
  | 'layer-via-copy'
  | 'merge-down'
  | 'free-transform'
  | 'invert-active-target'
  | 'selection-feather'
  | 'swap-colors'
  | 'reset-colors'
  | 'toggle-original'
  | 'toggle-screen-mode'
  | 'brush-size-decrease'
  | 'brush-size-increase'
  | 'brush-hardness-decrease'
  | 'brush-hardness-increase'
  | 'commit-transform'
  | 'activate-next-document'
  | 'activate-previous-document'
  | 'close-active-document'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'suppress-tab-navigation'
  | 'cancel-or-close'
  | { readonly type: 'activate-tool'; readonly tool: ToolId }
  | { readonly type: 'set-brush-percent'; readonly target: 'opacity' | 'flow'; readonly digit: number };

export interface EditorKeyChord {
  readonly key: string;
  readonly primary?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}

export interface EditorKeyBinding {
  readonly id: string;
  readonly chord: EditorKeyChord;
  readonly allowWhileEditing?: boolean;
  readonly when?: (context: EditorKeyboardContext) => boolean;
  readonly resolve: (
    context: EditorKeyboardContext
  ) => EditorKeyboardCommand;
}

export interface EditorKeymap {
  readonly id: string;
  readonly name: string;
  readonly bindings: readonly EditorKeyBinding[];
}

const command = (
  id: string,
  chord: EditorKeyChord,
  result: EditorKeyboardCommand,
  options: Pick<EditorKeyBinding, 'allowWhileEditing' | 'when'> = {}
): EditorKeyBinding => ({
  id,
  chord,
  ...options,
  resolve: () => result
});

const toolBindings: readonly EditorKeyBinding[] = TOOL_DEFINITIONS
  .filter((tool) => Boolean(tool.shortcutKey)
    && !TOOL_SHORTCUT_GROUPS.some((group) => group.key === tool.shortcutKey))
  .map((tool) => ({
    id: `tool.${tool.id}`,
    chord: {
      key: tool.shortcutKey!,
      primary: false,
      alt: false,
      shift: tool.shortcutShift
    },
    resolve: (context) =>
      tool.id === 'transform' && context.activeTool === 'transform'
        ? 'commit-transform'
        : { type: 'activate-tool', tool: tool.id }
  }));

const toolGroupBindings: readonly EditorKeyBinding[] = TOOL_SHORTCUT_GROUPS
  .flatMap((group) => [false, true].map((reverse) => ({
    id: `tool-group.${group.key}.${reverse ? 'reverse' : 'forward'}`,
    chord: {
      key: group.key,
      primary: false,
      alt: false,
      shift: reverse
    },
    resolve: (context: EditorKeyboardContext): EditorKeyboardCommand => ({
      type: 'activate-tool',
      tool: toolForShortcutCycle(group.key, context.activeTool, reverse)
        ?? context.activeTool
    })
  })));

const brushPercentBindings: readonly EditorKeyBinding[] = Array.from({ length: 10 }, (_, digit) => (
  [false, true].map((flow) => ({
    id: `brush.${flow ? 'flow' : 'opacity'}.${digit}`,
    chord: { key: String(digit), primary: false, alt: false, shift: flow },
    when: (context: EditorKeyboardContext) => usesBrushSize(context.activeTool),
    resolve: (): EditorKeyboardCommand => ({
      type: 'set-brush-percent',
      target: flow ? 'flow' : 'opacity',
      digit
    })
  }))
)).flat();

export const DEFAULT_EDITOR_KEYMAP: EditorKeymap = {
  id: 'lighttable-default',
  name: 'LightTable Default',
  bindings: [
    command('file.open', { key: 'o', primary: true, alt: false, shift: false }, 'open-file', {
      allowWhileEditing: true,
      when: (context) => !context.saving
    }),
    command('file.save', { key: 's', primary: true, alt: false, shift: false }, 'save-file', {
      allowWhileEditing: true,
      when: (context) => !context.saving && context.hasActiveLayer
    }),
    command(
      'file.quick-export-png',
      { key: 's', primary: true, alt: false, shift: true },
      'quick-export-png',
      {
        allowWhileEditing: true,
        when: (context) => !context.saving && context.hasActiveLayer
      }
    ),
    command('history.undo', { key: 'z', primary: true, alt: false, shift: false }, 'undo', {
      allowWhileEditing: true
    }),
    command('history.redo-shift', { key: 'z', primary: true, alt: false, shift: true }, 'redo', {
      allowWhileEditing: true
    }),
    command('history.redo-y', { key: 'y', primary: true, alt: false, shift: false }, 'redo', {
      allowWhileEditing: true
    }),
    command(
      'tool.temporary-pan',
      { key: 'space', primary: false, alt: false, shift: false },
      'temporary-pan-start'
    ),
    command('tool.temporary-erase', { key: '`', primary: false, alt: false, shift: false }, 'temporary-erase-start', {
      when: (context) => context.activeTool === 'brush'
    }),
    command('fill.foreground', { key: 'delete', primary: false, alt: true, shift: false }, 'fill-foreground'),
    command('fill.background', { key: 'delete', primary: true, alt: false, shift: false }, 'fill-background'),
    command('selection.all', { key: 'a', primary: true, alt: false, shift: false }, 'select-all'),
    command('selection.none', { key: 'd', primary: true, alt: false, shift: false }, 'select-none'),
    command('selection.invert', { key: 'i', primary: true, alt: false, shift: true }, 'select-invert'),
    command('selection.copy', { key: 'c', primary: true, alt: false, shift: false }, 'selection-copy', {
      when: (context) => context.hasSelection
    }),
    command(
      'selection.copy-merged',
      { key: 'c', primary: true, alt: false, shift: true },
      'selection-copy-merged',
      { when: (context) => context.hasSelection }
    ),
    command('selection.paste', { key: 'v', primary: true, alt: false, shift: false }, 'selection-paste', {
      when: (context) => !context.saving
    }),
    command('layer.via-copy', { key: 'j', primary: true, alt: false, shift: false }, 'layer-via-copy', {
      when: (context) => !context.saving
    }),
    command('layer.merge-down', { key: 'e', primary: true, alt: false, shift: false }, 'merge-down', {
      when: (context) => !context.saving && context.hasActiveLayer
    }),
    command('transform.free', { key: 't', primary: true, alt: true, shift: false }, 'free-transform', {
      when: (context) => !context.saving && context.hasActiveLayer
    }),
    command('layer.invert-target', { key: 'i', primary: true, alt: false, shift: false }, 'invert-active-target'),
    command('selection.feather', { key: 'f6', primary: false, alt: false, shift: true }, 'selection-feather', {
      when: (context) => context.hasSelection
    }),
    command('colors.swap', { key: 'x', primary: false, alt: false }, 'swap-colors'),
    command('colors.reset', { key: 'd', primary: false, alt: false, shift: false }, 'reset-colors'),
    command(
      'workspace.toggle-screen-mode',
      { key: 'f', primary: false, alt: false, shift: false },
      'toggle-screen-mode'
    ),
    command('brush.size-decrease', { key: '[', primary: false, alt: false, shift: false }, 'brush-size-decrease', {
      when: (context) => usesBrushSize(context.activeTool)
    }),
    command('brush.size-increase', { key: ']', primary: false, alt: false, shift: false }, 'brush-size-increase', {
      when: (context) => usesBrushSize(context.activeTool)
    }),
    command('brush.hardness-decrease', { key: '[', primary: false, alt: false, shift: true }, 'brush-hardness-decrease', {
      when: (context) => usesBrushSize(context.activeTool)
    }),
    command('brush.hardness-increase', { key: ']', primary: false, alt: false, shift: true }, 'brush-hardness-increase', {
      when: (context) => usesBrushSize(context.activeTool)
    }),
    ...brushPercentBindings,
    command(
      'workspace.previous-document',
      { key: 'tab', primary: true, alt: false, shift: true },
      'activate-previous-document'
    ),
    command(
      'workspace.next-document',
      { key: 'tab', primary: true, alt: false, shift: false },
      'activate-next-document'
    ),
    command(
      'workspace.close-document-w',
      { key: 'w', primary: true, alt: false, shift: false },
      'close-active-document',
      { when: (context) => !context.saving }
    ),
    command(
      'workspace.close-document-f4',
      { key: 'f4', primary: true, alt: false, shift: false },
      'close-active-document',
      { when: (context) => !context.saving }
    ),
    // Own the browser's native page-zoom chords. LightTable is a document
    // editor: these keys must change the active canvas view while the app UI
    // itself remains at the host's 100% zoom.
    command('viewport.zoom-in', { key: '+', primary: true, alt: false }, 'zoom-in', {
      allowWhileEditing: true
    }),
    command('viewport.zoom-out', { key: '-', primary: true, alt: false }, 'zoom-out', {
      allowWhileEditing: true
    }),
    command('viewport.zoom-fit', { key: '0', primary: true, alt: false }, 'zoom-fit', {
      allowWhileEditing: true
    }),
    command(
      'browser.suppress-tab-navigation',
      { key: 'tab', primary: false, alt: false },
      'suppress-tab-navigation',
      { allowWhileEditing: true }
    ),
    ...toolGroupBindings,
    ...toolBindings,
    command('transform.commit', { key: 'enter' }, 'commit-transform', {
      when: (context) => context.transforming
    }),
    command('editor.cancel-or-close', { key: 'escape' }, 'cancel-or-close', {
      when: (context) => !context.saving
    })
  ]
};

export const normalizedEditorKey = (
  input: Pick<EditorKeyboardInput, 'key' | 'code'>
): string => {
  if (input.code === 'Space') return 'space';
  if (input.code === 'Backquote') return '`';
  if (input.code === 'BracketLeft') return '[';
  if (input.code === 'BracketRight') return ']';
  if (input.code === 'Equal' || input.code === 'NumpadAdd') return '+';
  if (input.code === 'Minus' || input.code === 'NumpadSubtract') return '-';
  if (input.code === 'Digit0' || input.code === 'Numpad0') return '0';
  if (/^(Digit|Numpad)[1-9]$/.test(input.code)) return input.code.at(-1)!;
  if (input.key === 'Backspace' || input.key === 'Delete') return 'delete';
  return input.key.toLowerCase();
};

const modifierMatches = (
  expected: boolean | undefined,
  actual: boolean
) => expected === undefined || expected === actual;

export const editorKeyChordMatches = (
  chord: EditorKeyChord,
  input: EditorKeyboardInput
): boolean => (
  chord.key === normalizedEditorKey(input)
  && modifierMatches(chord.primary, input.ctrlKey || input.metaKey)
  && modifierMatches(chord.alt, input.altKey)
  && modifierMatches(chord.shift, input.shiftKey)
);

export const resolveEditorKeymapCommand = (
  keymap: EditorKeymap,
  input: EditorKeyboardInput,
  context: EditorKeyboardContext
): EditorKeyboardCommand | null => {
  const binding = keymap.bindings.find((candidate) =>
    editorKeyChordMatches(candidate.chord, input)
    && (!context.editable || candidate.allowWhileEditing)
    && (!candidate.when || candidate.when(context))
  );
  return binding?.resolve(context) ?? null;
};

const chordIdentity = (chord: EditorKeyChord): string => [
  chord.primary === undefined ? '*' : chord.primary ? 'primary' : 'no-primary',
  chord.alt === undefined ? '*' : chord.alt ? 'alt' : 'no-alt',
  chord.shift === undefined ? '*' : chord.shift ? 'shift' : 'no-shift',
  chord.key
].join('+');

export const findEditorKeymapConflicts = (
  keymap: EditorKeymap
): ReadonlyMap<string, readonly string[]> => {
  const bindingsByChord = new Map<string, string[]>();
  keymap.bindings.forEach((binding) => {
    const identity = chordIdentity(binding.chord);
    const ids = bindingsByChord.get(identity) ?? [];
    ids.push(binding.id);
    bindingsByChord.set(identity, ids);
  });
  return new Map(
    [...bindingsByChord].filter(([, ids]) => ids.length > 1)
  );
};
