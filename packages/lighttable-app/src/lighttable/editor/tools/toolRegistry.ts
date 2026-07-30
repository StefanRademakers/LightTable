import type { ToolId } from '../session/editorSession';

export type ToolRole = 'view' | 'transform' | 'selection' | 'fill' | 'paint';

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  readonly shortcutLabel: string;
  readonly shortcutKey: string;
  readonly shortcutShift?: boolean;
  readonly iconName: string;
  readonly role: ToolRole;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    id: 'transform',
    label: 'Transform',
    shortcutLabel: 'T',
    shortcutKey: 't',
    iconName: 'transform_tool.png',
    role: 'transform'
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
    iconName: 'select_free_shape.png',
    role: 'selection'
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
    definition.shortcutKey === key.toLowerCase()
    && (definition.shortcutShift === undefined || definition.shortcutShift === shiftKey)
  )?.id ?? null;
