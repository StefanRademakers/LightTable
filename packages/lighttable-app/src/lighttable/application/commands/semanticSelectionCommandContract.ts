import {
  selectionShapeIsValid,
  type MagicWandOptions,
  type SelectionCombineMode,
  type SelectionPoint,
  type SelectionShape
} from '../../editor/selection/selectionTypes';
import type { LayerId } from '../../editor/document/documentTypes';

export interface SemanticSelectionApplyShapeCommand {
  readonly kind: 'apply-shape';
  readonly mode: SelectionCombineMode;
  readonly shape: SelectionShape;
  readonly featherRadius: number;
  readonly antiAlias: boolean;
}

export interface SemanticSelectionModifyCommand {
  readonly kind: 'modify';
  readonly operation: 'all' | 'clear' | 'invert' | 'feather';
  readonly radius?: number;
}

export interface SemanticSelectionMagicWandCommand {
  readonly kind: 'magic-wand';
  readonly layerId: LayerId;
  readonly point: SelectionPoint;
  readonly mode: SelectionCombineMode;
  readonly options: MagicWandOptions;
}

export type SemanticSelectionCommand =
  | SemanticSelectionApplyShapeCommand
  | SemanticSelectionModifyCommand
  | SemanticSelectionMagicWandCommand;

const MAX_POINTS = 4096;
const MAX_COORDINATE = 10_000_000;
const shapeKinds = new Set<SelectionShape['kind']>(['rectangle', 'ellipse', 'free', 'polygon']);
const combineModes = new Set<SelectionCombineMode>(['replace', 'add', 'subtract', 'intersect']);
const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const parseSemanticSelectionCommand = (
  value: unknown
): SemanticSelectionCommand | { readonly message: string } => {
  if (record(value) && value.kind === 'modify') {
    if (value.operation !== 'all' && value.operation !== 'clear'
      && value.operation !== 'invert' && value.operation !== 'feather') {
      return { message: 'Selection modify requires operation all, clear, invert or feather.' };
    }
    const feather = value.operation === 'feather';
    if ((feather && (typeof value.radius !== 'number' || !Number.isFinite(value.radius)
      || value.radius < 0 || value.radius > 250))
      || (!feather && value.radius !== undefined)
      || Object.keys(value).some((key) => key !== 'kind' && key !== 'operation' && key !== 'radius')) {
      return { message: 'Selection modify contains unsupported properties.' };
    }
    return { kind: 'modify', operation: value.operation,
      ...(feather ? { radius: value.radius as number } : {}) };
  }
  if (record(value) && value.kind === 'magic-wand') {
    const point = value.point;
    const options = value.options;
    if (typeof value.layerId !== 'string' || !value.layerId || value.layerId.length > 512
      || !combineModes.has(value.mode as SelectionCombineMode)
      || !record(point) || typeof point.x !== 'number' || !Number.isFinite(point.x)
      || typeof point.y !== 'number' || !Number.isFinite(point.y)
      || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE
      || !record(options) || ![1, 3, 5, 11, 31, 51, 101].includes(options.sampleSize as number)
      || typeof options.tolerance !== 'number' || !Number.isFinite(options.tolerance)
      || options.tolerance < 0 || options.tolerance > 255
      || typeof options.antiAlias !== 'boolean' || typeof options.contiguous !== 'boolean'
      || typeof options.sampleAllLayers !== 'boolean') {
      return { message: 'Magic Wand requires a source layer, bounded point, combine mode and valid options.' };
    }
    const allowed = new Set(['kind', 'layerId', 'point', 'mode', 'options']);
    const optionKeys = new Set(['sampleSize', 'tolerance', 'antiAlias', 'contiguous', 'sampleAllLayers']);
    if (Object.keys(value).some((key) => !allowed.has(key))
      || Object.keys(point).some((key) => key !== 'x' && key !== 'y')
      || Object.keys(options).some((key) => !optionKeys.has(key))) {
      return { message: 'Magic Wand contains unsupported properties.' };
    }
    return {
      kind: 'magic-wand',
      layerId: value.layerId as LayerId,
      point: { x: point.x as number, y: point.y as number },
      mode: value.mode as SelectionCombineMode,
      options: {
        sampleSize: options.sampleSize as MagicWandOptions['sampleSize'],
        tolerance: Math.round(options.tolerance as number),
        antiAlias: options.antiAlias as boolean,
        contiguous: options.contiguous as boolean,
        sampleAllLayers: options.sampleAllLayers as boolean
      }
    };
  }
  if (!record(value) || !combineModes.has(value.mode as SelectionCombineMode)
    || !record(value.shape) || !shapeKinds.has(value.shape.kind as SelectionShape['kind'])
    || !Array.isArray(value.shape.points) || value.shape.points.length > MAX_POINTS) {
    return { message: 'Selection requires a mode and a bounded geometric shape.' };
  }
  const points = value.shape.points.map((point) => {
    if (!record(point) || typeof point.x !== 'number' || !Number.isFinite(point.x)
      || typeof point.y !== 'number' || !Number.isFinite(point.y)
      || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) return null;
    return { x: point.x, y: point.y };
  });
  if (points.some((point) => point === null)) {
    return { message: 'Selection points must contain finite bounded document coordinates.' };
  }
  const shape: SelectionShape = {
    kind: value.shape.kind as SelectionShape['kind'],
    points: points as SelectionShape['points']
  };
  if (!selectionShapeIsValid(shape)) return { message: 'The selection shape is empty or incomplete.' };
  const featherRadius = value.featherRadius ?? 0;
  const antiAlias = value.antiAlias ?? false;
  if (typeof featherRadius !== 'number' || !Number.isFinite(featherRadius)
    || featherRadius < 0 || featherRadius > 250 || typeof antiAlias !== 'boolean') {
    return { message: 'Selection featherRadius must be 0..250 and antiAlias must be boolean.' };
  }
  return {
    kind: 'apply-shape',
    mode: value.mode as SelectionCombineMode,
    shape,
    featherRadius,
    antiAlias
  };
};
