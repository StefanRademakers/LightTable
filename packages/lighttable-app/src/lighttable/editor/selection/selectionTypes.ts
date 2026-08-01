import type { LayerId } from '../document/documentTypes';

export type SelectionToolId =
  | 'select-rectangle'
  | 'select-ellipse'
  | 'select-free'
  | 'select-polygonal';
export type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';
export type SelectionMode = SelectionCombineMode | 'invert' | 'feather';
export type CompositeColorChannel = 'red' | 'green' | 'blue';
export type CompositeSelectionChannel = 'composite' | CompositeColorChannel;

export interface SelectionPoint {
  x: number;
  y: number;
}

export interface SelectionShape {
  kind: 'rectangle' | 'ellipse' | 'free' | 'polygon';
  points: SelectionPoint[];
}

export interface SelectionOperation {
  mode: SelectionMode;
  shape: SelectionShape;
  /** Raster-backed source used when a mask or composite channel becomes a selection. */
  source?:
    | { kind: 'layer-mask'; layerId: LayerId; pixelRevision: number }
    | { kind: 'composite-channel'; channel: CompositeSelectionChannel; documentRevision: number };
  /** Document-space feather radius. Only used by the feather operation. */
  amount?: number;
}

export const createLayerMaskSelectionOperation = (
  layerId: LayerId,
  pixelRevision: number,
  width: number,
  height: number
): SelectionOperation => ({
  mode: 'replace',
  source: { kind: 'layer-mask', layerId, pixelRevision },
  // Geometry is retained as the document coverage contract. Rendering uses
  // the raster source above, preserving feathered/painted mask values.
  shape: createFullCanvasSelection(width, height)[0].shape
});

export const createCompositeChannelSelectionOperation = (
  channel: CompositeSelectionChannel,
  documentRevision: number,
  width: number,
  height: number
): SelectionOperation => ({
  mode: 'replace',
  source: { kind: 'composite-channel', channel, documentRevision },
  shape: createFullCanvasSelection(width, height)[0].shape
});

export const createFullCanvasSelection = (
  width: number,
  height: number
): SelectionOperation[] => [{
  mode: 'replace',
  shape: {
    kind: 'rectangle',
    points: [
      { x: 0, y: 0 },
      { x: Math.max(0, width), y: Math.max(0, height) }
    ]
  }
}];

export const createInvertSelectionOperation = (
  width: number,
  height: number
): SelectionOperation => ({
  mode: 'invert',
  shape: createFullCanvasSelection(width, height)[0].shape
});

export const createFeatherSelectionOperation = (
  width: number,
  height: number,
  radius: number
): SelectionOperation => ({
  mode: 'feather',
  amount: Math.max(0, radius),
  shape: createFullCanvasSelection(width, height)[0].shape
});

/**
 * Resolves the operation once, when a selection gesture starts.
 *
 * The persistent Tool Options choice remains untouched. Shift/Alt only
 * override that choice for the gesture that is about to begin; modifiers
 * pressed later are therefore free to constrain selection geometry.
 */
export const resolveSelectionCombineMode = (
  baseMode: SelectionCombineMode,
  shiftKey: boolean,
  altKey: boolean
): SelectionCombineMode => {
  if (shiftKey && altKey) return 'intersect';
  if (shiftKey) return 'add';
  if (altKey) return 'subtract';
  return baseMode;
};

export const selectionModeFromModifiers = (
  shiftKey: boolean,
  altKey: boolean
): SelectionCombineMode => resolveSelectionCombineMode('replace', shiftKey, altKey);

export const selectionShapeIsValid = (shape: SelectionShape): boolean => {
  if (shape.kind === 'free' || shape.kind === 'polygon') return shape.points.length >= 3;
  if (shape.points.length < 2) return false;
  const [start, end] = shape.points;
  return Math.abs(end.x - start.x) >= 1 && Math.abs(end.y - start.y) >= 1;
};
