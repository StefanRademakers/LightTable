import type { ToolId } from '../session/editorSession';

export type ToolRole =
  | 'view'
  | 'zoom'
  | 'transform'
  | 'warp'
  | 'selection'
  | 'fill'
  | 'paint'
  | 'text'
  | 'vector';

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  readonly shortcutLabel?: string;
  readonly shortcutKey?: string;
  readonly shortcutShift?: boolean;
  readonly iconName: string;
  readonly role: ToolRole;
}

export interface ToolShortcutGroup {
  readonly key: string;
  readonly tools: readonly ToolId[];
  /** Photoshop-compatible first alternate when Shift is used from outside the group. */
  readonly shiftedEntry?: ToolId;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    id: 'transform',
    label: 'Transform',
    shortcutLabel: 'V',
    shortcutKey: 'v',
    iconName: 'transform_tool.png',
    role: 'transform'
  },
  {
    id: 'warp',
    label: 'Warp',
    shortcutLabel: 'W',
    shortcutKey: 'w',
    iconName: 'warp_tool.svg',
    role: 'warp'
  },
  {
    id: 'select-rectangle',
    label: 'Rectangular selection',
    shortcutLabel: 'M',
    shortcutKey: 'm',
    shortcutShift: false,
    iconName: 'select_rectangle.png',
    role: 'selection'
  },
  {
    id: 'select-ellipse',
    label: 'Elliptical selection',
    shortcutLabel: 'Shift+M',
    shortcutKey: 'm',
    shortcutShift: true,
    iconName: 'select_elipse.png',
    role: 'selection'
  },
  {
    id: 'select-free',
    label: 'Free selection',
    shortcutLabel: 'L',
    shortcutKey: 'l',
    shortcutShift: false,
    iconName: 'select_free_shape.png',
    role: 'selection'
  },
  {
    id: 'select-polygonal',
    label: 'Polygonal selection',
    shortcutLabel: 'Shift+L',
    shortcutKey: 'l',
    shortcutShift: true,
    iconName: 'tool_polygonal_selection.png',
    role: 'selection'
  },
  {
    id: 'select-horizontal',
    label: 'Horizontal selection',
    iconName: 'select_horizontal_line.png',
    role: 'selection'
  },
  {
    id: 'select-vertical',
    label: 'Vertical selection',
    iconName: 'select_vertical_line.png',
    role: 'selection'
  },
  {
    id: 'vector-select',
    label: 'Path selection',
    shortcutLabel: 'A',
    shortcutKey: 'a',
    shortcutShift: false,
    iconName: 'tool_path_select_tool.png',
    role: 'vector'
  },
  {
    id: 'vector-direct-select',
    label: 'Direct selection',
    shortcutLabel: 'Shift+A',
    shortcutKey: 'a',
    shortcutShift: true,
    iconName: 'tool_direct_select_tool.png',
    role: 'vector'
  },
  {
    id: 'vector-pen',
    label: 'Pen',
    shortcutLabel: 'P',
    shortcutKey: 'p',
    iconName: 'tool_pen_bezier_tool.png',
    role: 'vector'
  },
  {
    id: 'vector-add-anchor',
    label: 'Add anchor point',
    iconName: 'tool_pen_bezier_add_anchor_point.png',
    role: 'vector'
  },
  {
    id: 'vector-delete-anchor',
    label: 'Delete anchor point',
    iconName: 'tool_pen_bezier_remove_anchor_point.png',
    role: 'vector'
  },
  {
    id: 'vector-convert-anchor',
    label: 'Convert anchor point',
    iconName: 'tool_convert_point_tool.png',
    role: 'vector'
  },
  {
    id: 'shape-rectangle',
    label: 'Rectangle',
    shortcutLabel: 'U',
    shortcutKey: 'u',
    shortcutShift: false,
    iconName: 'tool_shape_rectangle.png',
    role: 'vector'
  },
  {
    id: 'shape-ellipse',
    label: 'Ellipse',
    shortcutLabel: 'Shift+U',
    shortcutKey: 'u',
    shortcutShift: true,
    iconName: 'tool_shape_ellipse.png',
    role: 'vector'
  },
  {
    id: 'shape-triangle',
    label: 'Triangle',
    iconName: 'tool_shape_triangle.png',
    role: 'vector'
  },
  {
    id: 'shape-line',
    label: 'Line',
    iconName: 'tool_shape_line.png',
    role: 'vector'
  },
  {
    id: 'text-point',
    label: 'Type tool',
    shortcutLabel: 'T',
    shortcutKey: 't',
    iconName: 'tool_text.png',
    role: 'text'
  },
  {
    id: 'text-paragraph',
    label: 'Paragraph text',
    iconName: 'tool_text.png',
    role: 'text'
  },
  {
    id: 'text-path',
    label: 'Path text',
    iconName: 'tool_text_on_path.png',
    role: 'text'
  },
  {
    id: 'gradient',
    label: 'Gradient',
    shortcutLabel: 'G',
    shortcutKey: 'g',
    iconName: 'tool_gradient.png',
    role: 'vector'
  },
  {
    id: 'fill',
    label: 'Paint bucket',
    iconName: 'tool_fill_color.png',
    role: 'fill'
  },
  {
    id: 'brush',
    label: 'Brush',
    shortcutLabel: 'B',
    shortcutKey: 'b',
    iconName: 'paint_brush.png',
    role: 'paint'
  },
  {
    id: 'erase',
    label: 'Erase',
    shortcutLabel: 'E',
    shortcutKey: 'e',
    iconName: 'erase.png',
    role: 'paint'
  },
  {
    id: 'view',
    label: 'Move canvas',
    shortcutLabel: 'H',
    shortcutKey: 'h',
    iconName: 'move_canvas.png',
    role: 'view'
  },
  {
    id: 'zoom',
    label: 'Zoom',
    shortcutLabel: 'Z',
    shortcutKey: 'z',
    iconName: 'tool_zoom.png',
    role: 'zoom'
  }
];

/** Selection tools share one toolbar slot while retaining their own shortcuts. */
export const SELECTION_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  TOOL_DEFINITIONS.filter(({ role }) => role === 'selection');

/** Live shapes share one toolbar slot while retaining their individual presets. */
export const SHAPE_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  TOOL_DEFINITIONS.filter(({ id }) => id.startsWith('shape-'));

/** Pen authoring and anchor-editing modes share one remembered toolbar slot. */
export const PEN_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  [
    'vector-pen',
    'vector-add-anchor',
    'vector-delete-anchor',
    'vector-convert-anchor'
  ].map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id)!);

/** User-facing Type modes share one slot; point/paragraph is gesture-derived. */
export const TEXT_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  ['text-point', 'text-path'].map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id)!);

/** Gradient and Paint Bucket share Photoshop's G toolbar slot. */
export const FILL_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  ['fill', 'gradient'].map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id)!);

/**
 * Photoshop-style tool families. The ordering is user-facing: repeatedly
 * pressing the family key walks forward, while Shift walks backward once a
 * member is active. Keeping this beside the registry prevents the keymap and
 * toolbar from inventing different notions of the same family.
 */
export const TOOL_SHORTCUT_GROUPS: readonly ToolShortcutGroup[] = [
  {
    key: 'a',
    tools: ['vector-select', 'vector-direct-select'],
    shiftedEntry: 'vector-direct-select'
  },
  {
    key: 'p',
    tools: [
      'vector-pen',
      'vector-add-anchor',
      'vector-delete-anchor',
      'vector-convert-anchor'
    ]
  },
  {
    key: 'g',
    tools: ['gradient', 'fill'],
    shiftedEntry: 'fill'
  },
  {
    key: 't',
    tools: ['text-point', 'text-path']
  },
  {
    key: 'u',
    tools: ['shape-rectangle', 'shape-ellipse', 'shape-triangle', 'shape-line'],
    shiftedEntry: 'shape-ellipse'
  }
];

const definitionsById = new Map<ToolId, ToolDefinition>(
  TOOL_DEFINITIONS.map((definition) => [definition.id, definition])
);

export const toolDefinition = (tool: ToolId): ToolDefinition => {
  const definition = definitionsById.get(tool);
  if (!definition) throw new Error(`Unknown editor tool: ${tool}`);
  return definition;
};

export const toolForShortcut = (key: string, shiftKey: boolean): ToolId | null =>
  TOOL_DEFINITIONS.find((definition) =>
    definition.shortcutKey !== undefined
    && definition.shortcutKey === key.toLowerCase()
    && (definition.shortcutShift === undefined || definition.shortcutShift === shiftKey)
  )?.id ?? null;

export const toolForShortcutCycle = (
  key: string,
  activeTool: ToolId,
  reverse: boolean
): ToolId | null => {
  const group = TOOL_SHORTCUT_GROUPS.find(
    (candidate) => candidate.key === key.toLowerCase()
  );
  if (!group) return null;
  const currentIndex = group.tools.indexOf(activeTool);
  if (currentIndex < 0) {
    return reverse && group.shiftedEntry
      ? group.shiftedEntry
      : group.tools[0] ?? null;
  }
  const offset = reverse ? -1 : 1;
  return group.tools[
    (currentIndex + offset + group.tools.length) % group.tools.length
  ] ?? null;
};
