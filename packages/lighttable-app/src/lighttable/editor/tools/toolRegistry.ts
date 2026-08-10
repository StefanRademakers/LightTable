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
  readonly iconName: string;
  readonly role: ToolRole;
}

export interface ToolShortcutGroup {
  readonly key: string;
  readonly tools: readonly ToolId[];
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
    id: 'select-rectangle',
    label: 'Rectangular selection',
    shortcutLabel: 'M',
    shortcutKey: 'm',
    iconName: 'select_rectangle.png',
    role: 'selection'
  },
  {
    id: 'select-ellipse',
    label: 'Elliptical selection',
    shortcutLabel: 'M',
    iconName: 'select_elipse.png',
    role: 'selection'
  },
  {
    id: 'select-horizontal',
    label: 'Horizontal selection',
    shortcutLabel: 'M',
    iconName: 'select_horizontal_line.png',
    role: 'selection'
  },
  {
    id: 'select-vertical',
    label: 'Vertical selection',
    shortcutLabel: 'M',
    iconName: 'select_vertical_line.png',
    role: 'selection'
  },
  {
    id: 'select-free',
    label: 'Free selection',
    shortcutLabel: 'L',
    shortcutKey: 'l',
    iconName: 'select_free_shape.png',
    role: 'selection'
  },
  {
    id: 'select-polygonal',
    label: 'Polygonal selection',
    shortcutLabel: 'L',
    iconName: 'tool_polygonal_selection.png',
    role: 'selection'
  },
  {
    id: 'select-magic-wand',
    label: 'Magic Wand',
    shortcutLabel: 'W',
    shortcutKey: 'w',
    iconName: 'tool_magic_wand.png',
    role: 'selection'
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
    id: 'text-vertical',
    label: 'Vertical type tool',
    shortcutLabel: 'T',
    iconName: 'tool_text_vertical.png',
    role: 'text'
  },
  {
    id: 'text-path',
    label: 'Path text',
    shortcutLabel: 'T',
    iconName: 'tool_text_on_path.png',
    role: 'text'
  },
  {
    id: 'vector-select',
    label: 'Path selection',
    shortcutLabel: 'A',
    shortcutKey: 'a',
    iconName: 'tool_path_select_tool.png',
    role: 'vector'
  },
  {
    id: 'vector-direct-select',
    label: 'Direct selection',
    shortcutLabel: 'A',
    iconName: 'tool_direct_select_tool.png',
    role: 'vector'
  },
  {
    id: 'shape-rectangle',
    label: 'Rectangle',
    shortcutLabel: 'U',
    shortcutKey: 'u',
    iconName: 'tool_shape_rectangle.png',
    role: 'vector'
  },
  {
    id: 'shape-ellipse',
    label: 'Ellipse',
    shortcutLabel: 'U',
    iconName: 'tool_shape_ellipse.png',
    role: 'vector'
  },
  {
    id: 'shape-triangle',
    label: 'Triangle',
    shortcutLabel: 'U',
    iconName: 'tool_shape_triangle.png',
    role: 'vector'
  },
  {
    id: 'shape-line',
    label: 'Line',
    shortcutLabel: 'U',
    iconName: 'tool_shape_line.png',
    role: 'vector'
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
    shortcutLabel: 'G',
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
    id: 'healing-brush',
    label: 'Healing Brush',
    shortcutLabel: 'J',
    shortcutKey: 'j',
    iconName: 'tool_spot_healing_brush.png',
    role: 'paint'
  },
  {
    id: 'clone-stamp',
    label: 'Clone Stamp',
    shortcutLabel: 'S',
    shortcutKey: 's',
    iconName: 'tool_clone_stamp.png',
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
    id: 'warp',
    label: 'Warp',
    iconName: 'warp_tool.svg',
    role: 'warp'
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

/** Photoshop-compatible marquee tools share the M toolbar slot. */
export const MARQUEE_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  ['select-rectangle', 'select-ellipse', 'select-horizontal', 'select-vertical']
    .map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id)!);

/** Free and polygonal selections share Photoshop's L toolbar slot. */
export const LASSO_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  ['select-free', 'select-polygonal']
    .map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id)!);

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

/** Whole-path and point editing share Photoshop's A toolbar slot. */
export const PATH_SELECTION_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  ['vector-select', 'vector-direct-select']
    .map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id)!);

/** User-facing Type modes share one slot; point/paragraph is gesture-derived. */
export const TEXT_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  ['text-point', 'text-vertical', 'text-path'].map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id)!);

/** Gradient and Paint Bucket share Photoshop's G toolbar slot. */
export const FILL_TOOL_DEFINITIONS: readonly ToolDefinition[] =
  ['gradient', 'fill'].map((id) => TOOL_DEFINITIONS.find((tool) => tool.id === id)!);

/**
 * Photoshop-style tool families. The plain family key restores its remembered
 * member; Shift+key advances to the next member. Keeping this beside the
 * registry prevents the keymap and toolbar from inventing different families.
 */
export const TOOL_SHORTCUT_GROUPS: readonly ToolShortcutGroup[] = [
  {
    key: 'm',
    tools: ['select-rectangle', 'select-ellipse', 'select-horizontal', 'select-vertical']
  },
  {
    key: 'l',
    tools: ['select-free', 'select-polygonal']
  },
  {
    key: 'w',
    tools: ['select-magic-wand']
  },
  {
    key: 'a',
    tools: ['vector-select', 'vector-direct-select']
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
    tools: ['gradient', 'fill']
  },
  {
    key: 't',
    tools: ['text-point', 'text-vertical', 'text-path']
  },
  {
    key: 'u',
    tools: ['shape-rectangle', 'shape-ellipse', 'shape-triangle', 'shape-line']
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

export const toolForShortcutFamily = (
  key: string,
  preferredTool: ToolId,
  advance: boolean
): ToolId | null => {
  const group = TOOL_SHORTCUT_GROUPS.find(
    (candidate) => candidate.key === key.toLowerCase()
  );
  if (!group) return null;
  const currentIndex = group.tools.indexOf(preferredTool);
  const preferredIndex = currentIndex < 0 ? 0 : currentIndex;
  if (!advance || group.tools.length === 1) return group.tools[preferredIndex] ?? null;
  return group.tools[(preferredIndex + 1) % group.tools.length] ?? null;
};

export const toolShortcutGroupFor = (tool: ToolId): ToolShortcutGroup | null =>
  TOOL_SHORTCUT_GROUPS.find((group) => group.tools.includes(tool)) ?? null;
