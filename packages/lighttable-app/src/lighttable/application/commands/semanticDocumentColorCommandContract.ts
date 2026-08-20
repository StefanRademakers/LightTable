export interface SemanticAssignProfileCommand {
  readonly profile: 'srgb';
}

export interface SemanticAssignProfileResult extends SemanticAssignProfileCommand {
  readonly changed: boolean;
  readonly profileState: 'assigned';
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** Assignment changes interpretation metadata; it never performs a color conversion. */
export const parseSemanticAssignProfileCommand = (
  value: unknown
): SemanticAssignProfileCommand | { readonly message: string } => {
  if (!record(value) || Object.keys(value).length !== 1 || value.profile !== 'srgb') {
    return { message: 'Assign Profile currently requires exactly profile "srgb".' };
  }
  return { profile: 'srgb' };
};
