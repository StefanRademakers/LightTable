import type { ToolId } from '../../editor/session/editorSession';
import {
  isPaintTool,
  isSelectionTool,
  isWarpTool
} from '../../editor/tools/toolCapabilities';

export type ViewportPointerDownIntent =
  | 'temporary-pan'
  | 'selection'
  | 'fill'
  | 'text-create'
  | 'warp'
  | 'view'
  | 'paint'
  | 'ignore';

export type ViewportPointerMoveIntent =
  | 'pan'
  | 'selection'
  | 'warp'
  | 'paint'
  | 'ignore';

export type ViewportPointerEndIntent = 'selection' | 'warp' | 'paint' | 'pan';

export interface ViewportPointerDownContext {
  activeTool: ToolId;
  temporaryPan: boolean;
  focusPickerActive: boolean;
  primaryButton: boolean;
  hasMetadata: boolean;
  hasDocument: boolean;
  hasDocumentPoint: boolean;
  hasPaintTarget: boolean;
  hasWarpTarget: boolean;
}

export interface ViewportPointerMoveContext {
  activeTool: ToolId;
  temporaryPan: boolean;
  panGestureMatches: boolean;
  selectionGestureMatches: boolean;
  warpGestureMatches: boolean;
  paintGestureMatches: boolean;
  hasDocumentPoint: boolean;
  hasPaintTarget: boolean;
  hasStrokeBuilder: boolean;
}

export interface ViewportPointerEndContext {
  selectionGestureMatches: boolean;
  warpGestureMatches: boolean;
  paintGestureMatches: boolean;
}

/**
 * Assigns a pointer-down gesture to exactly one editor subsystem.
 *
 * This function deliberately contains no React, DOM or renderer work. Once a
 * gesture has been assigned, the owning controller retains it until pointer-up
 * or cancellation. That keeps temporary tools, selections and transformed
 * paint targets from changing coordinate space halfway through a gesture.
 */
export const resolveViewportPointerDownIntent = (
  context: ViewportPointerDownContext
): ViewportPointerDownIntent => {
  if (context.temporaryPan) return 'temporary-pan';

  if (isSelectionTool(context.activeTool) && !context.focusPickerActive) {
    return context.primaryButton && context.hasMetadata && context.hasDocumentPoint
      ? 'selection'
      : 'ignore';
  }

  if (context.activeTool === 'fill' && !context.focusPickerActive) {
    return context.primaryButton && context.hasDocumentPoint ? 'fill' : 'ignore';
  }

  if (context.activeTool === 'text-point' && !context.focusPickerActive) {
    return context.primaryButton
      && context.hasDocument
      && context.hasDocumentPoint
      ? 'text-create'
      : 'ignore';
  }

  if (isWarpTool(context.activeTool) && !context.focusPickerActive) {
    return context.primaryButton
      && context.hasDocument
      && context.hasDocumentPoint
      && context.hasWarpTarget
      ? 'warp'
      : 'ignore';
  }

  if (!isPaintTool(context.activeTool) || context.focusPickerActive) return 'view';

  return context.primaryButton
    && context.hasDocument
    && context.hasDocumentPoint
    && context.hasPaintTarget
    ? 'paint'
    : 'ignore';
};

export const resolveViewportPointerMoveIntent = (
  context: ViewportPointerMoveContext
): ViewportPointerMoveIntent => {
  if (context.temporaryPan || context.panGestureMatches) return 'pan';
  if (context.selectionGestureMatches) return 'selection';
  if (context.warpGestureMatches) {
    return context.hasDocumentPoint ? 'warp' : 'ignore';
  }
  if (!isPaintTool(context.activeTool) || !context.paintGestureMatches) return 'pan';
  return context.hasDocumentPoint && context.hasPaintTarget && context.hasStrokeBuilder
    ? 'paint'
    : 'ignore';
};

export const resolveViewportPointerEndIntent = (
  context: ViewportPointerEndContext
): ViewportPointerEndIntent => {
  if (context.selectionGestureMatches) return 'selection';
  if (context.warpGestureMatches) return 'warp';
  if (context.paintGestureMatches) return 'paint';
  return 'pan';
};
