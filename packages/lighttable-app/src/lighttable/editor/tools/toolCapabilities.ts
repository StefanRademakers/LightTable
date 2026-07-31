import type { SelectionToolId } from '../selection/selectionTypes';
import type { ToolId } from '../session/editorSession';
import { toolDefinition } from './toolRegistry';

export const BRUSH_SIZE_STEPS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70,
  80, 90, 100, 125, 150, 175, 200, 250, 300, 400,
  500, 600, 700, 800, 900, 1000
] as const;

export type SelectionShapeKind = 'rectangle' | 'ellipse' | 'free' | 'polygon';

export const steppedBrushSize = (current: number, direction: -1 | 1): number => {
  if (direction > 0) {
    return BRUSH_SIZE_STEPS.find((size) => size > current)
      ?? BRUSH_SIZE_STEPS[BRUSH_SIZE_STEPS.length - 1];
  }
  for (let index = BRUSH_SIZE_STEPS.length - 1; index >= 0; index -= 1) {
    if (BRUSH_SIZE_STEPS[index] < current) return BRUSH_SIZE_STEPS[index];
  }
  return BRUSH_SIZE_STEPS[0];
};

export const isSelectionTool = (tool: ToolId): tool is SelectionToolId =>
  toolDefinition(tool).role === 'selection';

export const isPaintTool = (tool: ToolId): tool is 'brush' | 'erase' =>
  toolDefinition(tool).role === 'paint';

export const isWarpTool = (tool: ToolId): tool is 'warp' =>
  toolDefinition(tool).role === 'warp';

/** Tools whose on-canvas interaction is driven by a brush diameter. */
export const usesBrushSize = (tool: ToolId): tool is 'brush' | 'erase' | 'warp' =>
  isPaintTool(tool) || isWarpTool(tool);

export const selectionKindForTool = (tool: SelectionToolId): SelectionShapeKind => {
  switch (tool) {
    case 'select-rectangle':
      return 'rectangle';
    case 'select-ellipse':
      return 'ellipse';
    case 'select-free':
      return 'free';
    case 'select-polygonal':
      return 'polygon';
  }
};
