import type { ToolId } from '../session/editorSession';

export type ToolRole =
  | 'view'
  | 'zoom'
  | 'transform'
  | 'warp'
  | 'selection'
  | 'fill'
  | 'paint'
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
    id: 'fill',
    label: 'Fill',
    shortcutLabel: 'G',
    shortcutKey: 'g',
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
