import type { ToolId } from '../../editor/session/editorSession';

export type EditorDeleteTarget = 'vector-selection' | 'pixel-selection' | 'layers';

const VECTOR_SUBOBJECT_TOOLS: ReadonlySet<ToolId> = new Set([
  'vector-select',
  'vector-direct-select',
  'vector-pen',
  'vector-add-anchor',
  'vector-delete-anchor',
  'vector-convert-anchor'
]);

/**
 * Resolves Delete/Backspace from the most specific editing context outward.
 * Native inputs and live Type editing never reach this resolver: the keyboard
 * router deliberately leaves those events with their focused input bridge.
 */
export const resolveDeleteTarget = (context: {
  readonly activeTool: ToolId;
  readonly hasVectorSelection: boolean;
  readonly hasPixelSelection: boolean;
  readonly hasActiveLayer: boolean;
}): EditorDeleteTarget | null => {
  if (VECTOR_SUBOBJECT_TOOLS.has(context.activeTool) && context.hasVectorSelection) {
    return 'vector-selection';
  }
  if (context.hasPixelSelection) return 'pixel-selection';
  return context.hasActiveLayer ? 'layers' : null;
};
