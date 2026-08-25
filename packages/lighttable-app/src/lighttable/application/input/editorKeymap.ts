import type { ToolId } from '../../editor/session/editorSession';
import type { AdjustmentLayerKind } from '../../processing/adjustmentLayerCatalog';
import { usesBrushSize } from '../../editor/tools/toolCapabilities';
import {
  TOOL_DEFINITIONS,
  TOOL_SHORTCUT_GROUPS,
  toolForShortcutFamily
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
  readonly documentKind?: 'image' | 'video' | 'model-3d';
  readonly editable: boolean;
  readonly saving: boolean;
  readonly activeTool: ToolId;
  readonly preferredTools?: Readonly<Partial<Record<string, ToolId>>>;
  readonly hasActiveLayer: boolean;
  readonly hasSelection: boolean;
  readonly hasSelectionClipboard: boolean;
  readonly transforming: boolean;
}

export type EditorKeyboardCommand =
  | 'open-file'
  | 'save-file'
  | 'quick-export-png'
  | 'open-image-size'
  | 'undo'
  | 'redo'
  | 'temporary-pan-start'
  | 'temporary-zoom-in-start'
  | 'temporary-zoom-out-start'
  | 'temporary-erase-start'
  | 'fill-foreground'
  | 'fill-background'
  | 'fill-foreground-preserve'
  | 'fill-background-preserve'
  | 'open-fill-dialog'
  | 'delete-active-target'
  | 'select-all'
  | 'select-none'
  | 'select-invert'
  | 'selection-copy'
  | 'selection-copy-merged'
  | 'selection-paste'
  | 'layer-via-copy'
  | 'merge-down'
  | 'free-transform'
  | 'repeat-transform'
  | 'repeat-transform-duplicate'
  | 'invert-active-target'
  | 'selection-feather'
  | 'swap-colors'
  | 'reset-colors'
  | 'toggle-extras'
  | 'toggle-rulers'
  | 'toggle-snap'
  | 'toggle-screen-mode'
  | 'brush-size-decrease'
  | 'brush-size-increase'
  | 'brush-hardness-decrease'
  | 'brush-hardness-increase'
  | 'open-brush-settings'
  | 'commit-transform'
  | 'commit-active-operation'
  | 'activate-next-document'
  | 'activate-previous-document'
  | 'close-active-document'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'zoom-actual'
  | 'cancel-active-operation'
  | { readonly type: 'activate-tool'; readonly tool: ToolId }
  | { readonly type: 'apply-adjustment'; readonly kind: AdjustmentLayerKind }
  | { readonly type: 'set-brush-percent'; readonly target: 'opacity' | 'flow'; readonly digit: number }
  | { readonly type: 'nudge'; readonly x: number; readonly y: number };

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
  /** Omitted bindings belong to the image editor. */
  readonly documentKinds?: readonly ('image' | 'video' | 'model-3d')[];
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
  options: Pick<EditorKeyBinding, 'allowWhileEditing' | 'documentKinds' | 'when'> = {}
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
      alt: false
    },
    ...(tool.id === 'view' || tool.id === 'zoom'
      ? { documentKinds: ['image', 'video'] as const }
      : {}),
    resolve: (context) =>
      tool.id === 'transform' && context.activeTool === 'transform'
        ? 'commit-transform'
        : { type: 'activate-tool', tool: tool.id }
  }));

const toolGroupBindings: readonly EditorKeyBinding[] = TOOL_SHORTCUT_GROUPS
  .flatMap((group) => [false, true].map((advance) => ({
    id: `tool-group.${group.key}.${advance ? 'next' : 'current'}`,
    chord: {
      key: group.key,
      primary: false,
      alt: false,
      shift: advance
    },
    resolve: (context: EditorKeyboardContext): EditorKeyboardCommand => ({
      type: 'activate-tool',
      tool: toolForShortcutFamily(
        group.key,
        context.preferredTools?.[group.key] ?? context.activeTool,
        advance
      )
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

const nudgeBindings: readonly EditorKeyBinding[] = ([
  ['arrowleft', -1, 0],
  ['arrowright', 1, 0],
  ['arrowup', 0, -1],
  ['arrowdown', 0, 1]
] as const).flatMap(([key, x, y]) => [false, true].map((large) => ({
  id: `editor.nudge.${key}.${large ? 'large' : 'small'}`,
  chord: { key, primary: false, alt: false, shift: large },
  when: (context: EditorKeyboardContext) => context.transforming || (
    context.hasSelection && context.activeTool.startsWith('select-')
  ),
  resolve: (): EditorKeyboardCommand => ({
    type: 'nudge',
    x: x * (large ? 10 : 1),
    y: y * (large ? 10 : 1)
  })
})));

export const DEFAULT_EDITOR_KEYMAP: EditorKeymap = {
  id: 'lighttable-default',
  name: 'LightTable Default',
  bindings: [
    command('file.open', { key: 'o', primary: true, alt: false, shift: false }, 'open-file', {
      allowWhileEditing: true,
      documentKinds: ['image', 'video', 'model-3d'],
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
    command('image.size', { key: 'i', primary: true, alt: true, shift: false }, 'open-image-size', {
      allowWhileEditing: true,
      // Image Size is document-scoped, not layer-scoped. Requiring an active
      // layer made the shortcut silently fail while the same menu item worked.
      when: (context) => !context.saving
    }),
    command('image.adjustments.levels', { key: 'l', primary: true, alt: false, shift: false }, {
      type: 'apply-adjustment', kind: 'levels'
    }, { when: (context) => !context.saving }),
    command('image.adjustments.curves', { key: 'm', primary: true, alt: false, shift: false }, {
      type: 'apply-adjustment', kind: 'curves'
    }, { when: (context) => !context.saving }),
    command('image.adjustments.hue-saturation', { key: 'u', primary: true, alt: false, shift: false }, {
      type: 'apply-adjustment', kind: 'hue-saturation'
    }, { when: (context) => !context.saving }),
    command('image.adjustments.color-balance', { key: 'b', primary: true, alt: false, shift: false }, {
      type: 'apply-adjustment', kind: 'color-balance'
    }, { when: (context) => !context.saving }),
    command('image.adjustments.black-white', { key: 'b', primary: true, alt: true, shift: true }, {
      type: 'apply-adjustment', kind: 'black-white'
    }, { when: (context) => !context.saving }),
    command(
      'layer.invert-target',
      { key: 'i', primary: true, alt: false, shift: false },
      'invert-active-target',
      { when: (context) => !context.saving && context.hasActiveLayer }
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
      'tool.temporary-zoom-in',
      { key: 'space', primary: true, alt: false, shift: false },
      'temporary-zoom-in-start',
      { documentKinds: ['image', 'video'] }
    ),
    command(
      'tool.temporary-zoom-out',
      { key: 'space', primary: false, alt: true, shift: false },
      'temporary-zoom-out-start',
      { documentKinds: ['image', 'video'] }
    ),
    command(
      'tool.temporary-pan',
      { key: 'space', primary: false, alt: false, shift: false },
      'temporary-pan-start',
      { documentKinds: ['image', 'video'] }
    ),
    command('tool.temporary-erase', { key: '`', primary: false, alt: false, shift: false }, 'temporary-erase-start', {
      when: (context) => context.activeTool === 'brush'
    }),
    command('fill.foreground', { key: 'delete', primary: false, alt: true, shift: false }, 'fill-foreground'),
    command('fill.background', { key: 'delete', primary: true, alt: false, shift: false }, 'fill-background'),
    command('fill.foreground-preserve', { key: 'delete', primary: false, alt: true, shift: true }, 'fill-foreground-preserve'),
    command('fill.background-preserve', { key: 'delete', primary: true, alt: false, shift: true }, 'fill-background-preserve'),
    command('fill.dialog', { key: 'f5', primary: false, alt: false, shift: true }, 'open-fill-dialog'),
    command(
      'edit.delete-active-target',
      { key: 'delete', primary: false, alt: false, shift: false },
      'delete-active-target',
      { when: (context) => !context.saving && context.hasActiveLayer }
    ),
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
    command('transform.free', { key: 't', primary: true, alt: false, shift: false }, 'free-transform', {
      when: (context) => !context.saving && context.hasActiveLayer
    }),
    command('transform.repeat', { key: 't', primary: true, alt: false, shift: true }, 'repeat-transform', {
      when: (context) => !context.saving && context.hasActiveLayer && !context.transforming
    }),
    command('transform.repeat-duplicate', { key: 't', primary: true, alt: true, shift: true }, 'repeat-transform-duplicate', {
      when: (context) => !context.saving && context.hasActiveLayer && !context.transforming
    }),
    command('selection.feather', { key: 'f6', primary: false, alt: false, shift: true }, 'selection-feather', {
      when: (context) => context.hasSelection
    }),
    ...nudgeBindings,
    command('colors.swap', { key: 'x', primary: false, alt: false }, 'swap-colors'),
    command('colors.reset', { key: 'd', primary: false, alt: false, shift: false }, 'reset-colors'),
    command('view.extras', { key: 'h', primary: true, alt: false, shift: false }, 'toggle-extras', {
      allowWhileEditing: true
    }),
    command('view.rulers', { key: 'r', primary: true, alt: false, shift: false }, 'toggle-rulers', {
      allowWhileEditing: true
    }),
    command('view.snap', { key: ';', primary: true, alt: false, shift: true }, 'toggle-snap', {
      allowWhileEditing: true
    }),
    command(
      'workspace.toggle-screen-mode',
      { key: 'f', primary: false, alt: false, shift: false },
      'toggle-screen-mode',
      { documentKinds: ['image', 'video', 'model-3d'] }
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
    command('brush.open-settings', { key: 'f5', primary: false, alt: false, shift: false }, 'open-brush-settings', {
      when: (context) => context.activeTool === 'brush'
    }),
    ...brushPercentBindings,
    command(
      'workspace.previous-document',
      { key: 'tab', primary: true, alt: false, shift: true },
      'activate-previous-document',
      { documentKinds: ['image', 'video', 'model-3d'] }
    ),
    command(
      'workspace.next-document',
      { key: 'tab', primary: true, alt: false, shift: false },
      'activate-next-document',
      { documentKinds: ['image', 'video', 'model-3d'] }
    ),
    command(
      'workspace.close-document-w',
      { key: 'w', primary: true, alt: false, shift: false },
      'close-active-document',
      {
        documentKinds: ['image', 'video', 'model-3d'],
        when: (context) => !context.saving
      }
    ),
    command(
      'workspace.close-document-f4',
      { key: 'f4', primary: true, alt: false, shift: false },
      'close-active-document',
      {
        documentKinds: ['image', 'video', 'model-3d'],
        when: (context) => !context.saving
      }
    ),
    // Own the browser's native page-zoom chords. LightTable is a document
    // editor: these keys must change the active canvas view while the app UI
    // itself remains at the host's 100% zoom.
    command('viewport.zoom-in', { key: '+', primary: true, alt: false }, 'zoom-in', {
      allowWhileEditing: true,
      documentKinds: ['image', 'video']
    }),
    command('viewport.zoom-out', { key: '-', primary: true, alt: false }, 'zoom-out', {
      allowWhileEditing: true,
      documentKinds: ['image', 'video']
    }),
    command('viewport.zoom-fit', { key: '0', primary: true, alt: false }, 'zoom-fit', {
      allowWhileEditing: true,
      documentKinds: ['image', 'video']
    }),
    command('viewport.zoom-actual', { key: '1', primary: true, alt: false }, 'zoom-actual', {
      allowWhileEditing: true,
      documentKinds: ['image', 'video']
    }),
    ...toolGroupBindings,
    ...toolBindings,
    command('editor.commit-context', { key: 'enter' }, 'commit-active-operation', {
      when: (context) => context.transforming || context.activeTool === 'vector-pen'
    }),
    command('editor.cancel-active-operation', { key: 'escape' }, 'cancel-active-operation', {
      when: (context) => !context.saving
    })
  ]
};

export const normalizedEditorKey = (
  input: Pick<EditorKeyboardInput, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>
): string => {
  // On Windows, Ctrl+Alt can be exposed as AltGr and event.key may consequently
  // contain a composed character instead of the shortcut letter. KeyboardEvent.code
  // remains stable (for example KeyI), so use it for modified letter chords while
  // retaining layout-aware event.key handling for unmodified tool shortcuts.
  if ((input.ctrlKey || input.metaKey || input.altKey) && /^Key[A-Z]$/.test(input.code)) {
    return input.code.slice(3).toLowerCase();
  }
  if (input.code === 'Space') return 'space';
  if (input.code === 'Backquote') return '`';
  if (input.code === 'BracketLeft') return '[';
  if (input.code === 'BracketRight') return ']';
  if (input.code === 'Semicolon') return ';';
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
  const documentKind = context.documentKind ?? 'image';
  const binding = keymap.bindings.find((candidate) =>
    editorKeyChordMatches(candidate.chord, input)
    && (candidate.documentKinds ?? ['image']).includes(documentKind)
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
