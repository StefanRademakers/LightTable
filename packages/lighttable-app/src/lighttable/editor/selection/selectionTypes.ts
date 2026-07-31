export type SelectionToolId =
  | 'select-rectangle'
  | 'select-ellipse'
  | 'select-free'
  | 'select-polygonal';
export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect' | 'invert' | 'feather';

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
  /** Document-space feather radius. Only used by the feather operation. */
  amount?: number;
}

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

export const selectionModeFromModifiers = (shiftKey: boolean, altKey: boolean): SelectionMode => {
  if (shiftKey && altKey) return 'intersect';
  if (shiftKey) return 'add';
  if (altKey) return 'subtract';
  return 'replace';
};

export const selectionShapeIsValid = (shape: SelectionShape): boolean => {
  if (shape.kind === 'free' || shape.kind === 'polygon') return shape.points.length >= 3;
  if (shape.points.length < 2) return false;
  const [start, end] = shape.points;
  return Math.abs(end.x - start.x) >= 1 && Math.abs(end.y - start.y) >= 1;
};
