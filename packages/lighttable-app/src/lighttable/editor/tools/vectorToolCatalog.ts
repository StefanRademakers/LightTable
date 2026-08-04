import type { LiveShapeToolPreset } from '../../application/vectors/LiveShapeToolController';
import type { VectorToolMode } from '../../application/vectors/VectorToolSessionController';

export type VectorEditorToolId =
  | 'vector-select'
  | 'vector-direct-select'
  | 'vector-pen'
  | 'vector-add-anchor'
  | 'vector-delete-anchor'
  | 'vector-convert-anchor'
  | 'shape-rectangle'
  | 'shape-ellipse'
  | 'shape-triangle'
  | 'shape-line'
  | 'gradient';

export interface VectorToolActivation {
  readonly mode: VectorToolMode;
  readonly preset?: LiveShapeToolPreset;
}

const ACTIVATIONS: Readonly<Record<VectorEditorToolId, VectorToolActivation>> = {
  'vector-select': { mode: 'element-selection' },
  'vector-direct-select': { mode: 'direct-selection' },
  'vector-pen': { mode: 'pen' },
  'vector-add-anchor': { mode: 'add-anchor' },
  'vector-delete-anchor': { mode: 'delete-anchor' },
  'vector-convert-anchor': { mode: 'convert-anchor' },
  'shape-rectangle': { mode: 'live-shape', preset: { kind: 'rectangle' } },
  'shape-ellipse': { mode: 'live-shape', preset: { kind: 'ellipse' } },
  'shape-triangle': { mode: 'live-shape', preset: { kind: 'triangle' } },
  'shape-line': { mode: 'live-shape', preset: { kind: 'line' } },
  gradient: { mode: 'gradient' }
};

export const isVectorEditorTool = (tool: string): tool is VectorEditorToolId =>
  Object.hasOwn(ACTIVATIONS, tool);

export const vectorToolActivation = (
  tool: VectorEditorToolId
): VectorToolActivation => ACTIVATIONS[tool];
