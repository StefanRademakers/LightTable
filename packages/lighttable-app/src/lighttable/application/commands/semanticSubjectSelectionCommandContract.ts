import type { LayerId } from '../../editor/document/documentTypes';
import type { SelectionCombineMode } from '../../editor/selection/selectionTypes';

export interface SemanticSubjectSelectionCommand {
  readonly kind: 'subject';
  readonly sourceLayerId: LayerId;
  readonly mode: SelectionCombineMode;
  readonly sampleAllLayers: boolean;
}

export interface SemanticSubjectSelectionResult {
  readonly kind: 'subject';
  readonly sourceLayerId: LayerId;
  readonly mode: SelectionCombineMode;
  readonly sampleAllLayers: boolean;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const parseSemanticSubjectSelectionCommand = (
  value: unknown
): SemanticSubjectSelectionCommand | { readonly message: string } => {
  if (!record(value)
    || Object.keys(value).some((key) => !['kind', 'sourceLayerId', 'mode', 'sampleAllLayers'].includes(key))
    || value.kind !== 'subject'
    || typeof value.sourceLayerId !== 'string'
    || value.sourceLayerId.length < 1
    || value.sourceLayerId.length > 512
    || !['replace', 'add', 'subtract', 'intersect'].includes(String(value.mode))
    || typeof value.sampleAllLayers !== 'boolean') {
    return { message: 'Select Subject requires an explicit source, combine mode and sampling scope.' };
  }
  return {
    kind: 'subject', sourceLayerId: value.sourceLayerId as LayerId,
    mode: value.mode as SelectionCombineMode,
    sampleAllLayers: value.sampleAllLayers
  };
};
