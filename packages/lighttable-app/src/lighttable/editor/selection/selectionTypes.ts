import type { LayerId } from '../document/documentTypes';

export type SelectionToolId =
  | 'select-rectangle'
  | 'select-ellipse'
  | 'select-horizontal'
  | 'select-vertical'
  | 'select-free'
  | 'select-polygonal'
  | 'select-magic-wand';
export type GeometricSelectionToolId = Exclude<SelectionToolId, 'select-magic-wand'>;
export type SelectionCombineMode = 'replace' | 'add' | 'subtract' | 'intersect';
export type SelectionMode = SelectionCombineMode | 'invert' | 'feather' | 'transform';
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

export type MagicWandSampleSize = 1 | 3 | 5 | 11 | 31 | 51 | 101;

export interface MagicWandOptions {
  sampleSize: MagicWandSampleSize;
  tolerance: number;
  antiAlias: boolean;
  contiguous: boolean;
  sampleAllLayers: boolean;
}

export const createDefaultMagicWandOptions = (): MagicWandOptions => ({
  sampleSize: 1,
  tolerance: 20,
  antiAlias: true,
  contiguous: true,
  sampleAllLayers: false
});

export interface SelectionOperation {
  mode: SelectionMode;
  shape: SelectionShape;
  /** Raster-backed source used when a mask or composite channel becomes a selection. */
  source?:
    | { kind: 'layer-mask'; layerId: LayerId; pixelRevision: number }
    | { kind: 'layer-transparency'; layerId: LayerId; pixelRevision: number }
    | { kind: 'composite-channel'; channel: CompositeSelectionChannel; documentRevision: number }
    | {
        kind: 'magic-wand';
        point: SelectionPoint;
        options: MagicWandOptions;
        layerId: LayerId;
        documentRevision: number;
      };
  /** Document-space feather radius. Only used by the feather operation. */
  amount?: number;
  /** Replayable affine edit for raster-backed and geometric selections alike. */
  transform?: {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
  };
}

export const createMagicWandSelectionOperation = (
  layerId: LayerId,
  documentRevision: number,
  width: number,
  height: number,
  point: SelectionPoint,
  options: MagicWandOptions,
  mode: SelectionCombineMode
): SelectionOperation => ({
  mode,
  source: {
    kind: 'magic-wand',
    point: { ...point },
    options: {
      ...options,
      tolerance: Math.max(0, Math.min(255, Math.round(options.tolerance)))
    },
    layerId,
    documentRevision
  },
  shape: createFullCanvasSelection(width, height)[0].shape
});

export const createTranslateSelectionOperation = (
  width: number,
  height: number,
  x: number,
  y: number
): SelectionOperation => ({
  mode: 'transform',
  transform: { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y },
  shape: createFullCanvasSelection(width, height)[0].shape
});

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

export const createLayerTransparencySelectionOperation = (
  layerId: LayerId,
  pixelRevision: number,
  width: number,
  height: number
): SelectionOperation => ({
  mode: 'replace',
  source: { kind: 'layer-transparency', layerId, pixelRevision },
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
