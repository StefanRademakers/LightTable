import type { LayerId } from '../../editor/document/documentTypes';
import type { GradeModuleGroup, LocalProcessingKind } from '../../processing/adjustmentStack';

export type ProcessingStructureTarget =
  | { readonly kind: 'local'; readonly layerId: LayerId; readonly owner: LocalProcessingKind }
  | { readonly kind: 'attached'; readonly layerId: LayerId; readonly adjustmentId: string };

export type GradeStructureTarget =
  | { readonly kind: 'layer'; readonly layerId: LayerId }
  | { readonly kind: 'attached'; readonly layerId: LayerId; readonly adjustmentId: string };

export type SemanticProcessingStructureCommand =
  | { readonly operation: 'set-enabled'; readonly target: ProcessingStructureTarget;
    readonly enabled: boolean }
  | { readonly operation: 'remove'; readonly target: ProcessingStructureTarget }
  | { readonly operation: 'set-grade-group-enabled'; readonly target: GradeStructureTarget;
    readonly group: GradeModuleGroup; readonly enabled: boolean };

export type SemanticProcessingStructureResult = SemanticProcessingStructureCommand & {
  readonly changed: boolean;
};

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const id = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= 512
);
const localOwners = new Set<string>(['grade', 'curves', 'lens-fx']);
const gradeGroups = new Set<string>([
  'light', 'color', 'colorMixer', 'colorGrading', 'blackWhiteMix',
  'look', 'curves', 'effects', 'detail'
]);

const processingTarget = (value: unknown): ProcessingStructureTarget | null => {
  if (!record(value) || !id(value.layerId)) return null;
  if (value.kind === 'local' && typeof value.owner === 'string'
    && localOwners.has(value.owner) && Object.keys(value).length === 3) {
    return { kind: 'local', layerId: value.layerId as LayerId,
      owner: value.owner as LocalProcessingKind };
  }
  if (value.kind === 'attached' && id(value.adjustmentId)
    && Object.keys(value).length === 3) {
    return { kind: 'attached', layerId: value.layerId as LayerId,
      adjustmentId: value.adjustmentId };
  }
  return null;
};

const gradeTarget = (value: unknown): GradeStructureTarget | null => {
  if (!record(value) || !id(value.layerId)) return null;
  if (value.kind === 'layer' && Object.keys(value).length === 2) {
    return { kind: 'layer', layerId: value.layerId as LayerId };
  }
  if (value.kind === 'attached' && id(value.adjustmentId)
    && Object.keys(value).length === 3) {
    return { kind: 'attached', layerId: value.layerId as LayerId,
      adjustmentId: value.adjustmentId };
  }
  return null;
};

export const parseSemanticProcessingStructureCommand = (
  value: unknown
): SemanticProcessingStructureCommand | { readonly message: string } => {
  if (!record(value) || typeof value.operation !== 'string') {
    return { message: 'Processing structure requires an operation and target.' };
  }
  if (value.operation === 'set-enabled') {
    const target = processingTarget(value.target);
    return target && typeof value.enabled === 'boolean' && Object.keys(value).length === 3
      ? { operation: value.operation, target, enabled: value.enabled }
      : { message: 'Processing enable requires a local or attached target and enabled.' };
  }
  if (value.operation === 'remove') {
    const target = processingTarget(value.target);
    return target && Object.keys(value).length === 2
      ? { operation: value.operation, target }
      : { message: 'Processing removal requires a local or attached target.' };
  }
  if (value.operation === 'set-grade-group-enabled') {
    const target = gradeTarget(value.target);
    return target && typeof value.group === 'string' && gradeGroups.has(value.group)
      && typeof value.enabled === 'boolean' && Object.keys(value).length === 4
      ? { operation: value.operation, target, group: value.group as GradeModuleGroup,
        enabled: value.enabled }
      : { message: 'Grade group enable requires a grade target, group and enabled.' };
  }
  return { message: 'Processing structure operation is unsupported.' };
};
