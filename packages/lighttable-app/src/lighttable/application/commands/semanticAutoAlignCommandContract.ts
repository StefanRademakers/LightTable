import type { LayerId } from '../../editor/document/documentTypes';

export interface SemanticAutoAlignCommand {
  readonly referenceLayerId: LayerId;
  readonly targetLayerId: LayerId;
}

export const parseSemanticAutoAlignCommand = (
  value: unknown
): SemanticAutoAlignCommand | { readonly message: string } => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { message: 'Auto Align parameters must be an object.' };
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'referenceLayerId' && key !== 'targetLayerId')
    || typeof input.referenceLayerId !== 'string' || !input.referenceLayerId
    || typeof input.targetLayerId !== 'string' || !input.targetLayerId
    || input.referenceLayerId === input.targetLayerId) {
    return { message: 'Auto Align requires exactly two distinct referenceLayerId and targetLayerId values.' };
  }
  return { referenceLayerId: input.referenceLayerId as LayerId,
    targetLayerId: input.targetLayerId as LayerId };
};
