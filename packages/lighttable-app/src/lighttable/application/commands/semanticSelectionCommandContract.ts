import {
  selectionShapeIsValid,
  type SelectionCombineMode,
  type SelectionShape
} from '../../editor/selection/selectionTypes';

export interface SemanticSelectionApplyShapeCommand {
  readonly kind: 'apply-shape';
  readonly mode: SelectionCombineMode;
  readonly shape: SelectionShape;
  readonly featherRadius: number;
  readonly antiAlias: boolean;
}

export interface SemanticSelectionModifyCommand {
  readonly kind: 'modify';
  readonly operation: 'all' | 'clear' | 'invert';
}

export type SemanticSelectionCommand =
  | SemanticSelectionApplyShapeCommand
  | SemanticSelectionModifyCommand;

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
      && value.operation !== 'invert') {
      return { message: 'Selection modify requires operation all, clear or invert.' };
    }
    if (Object.keys(value).some((key) => key !== 'kind' && key !== 'operation')) {
      return { message: 'Selection modify contains unsupported properties.' };
    }
    return { kind: 'modify', operation: value.operation };
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
