export interface SemanticPasteGradeCommand {
  readonly artifactId: string;
}

const record = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const parseSemanticCopyGradeCommand = (
  value: unknown
): Record<string, never> | { readonly message: string } => (
  record(value) && Object.keys(value).length === 0
    ? {}
    : { message: 'Copy Grade parameters must be an empty object.' }
);

export const parseSemanticPasteGradeCommand = (
  value: unknown
): SemanticPasteGradeCommand | { readonly message: string } => {
  if (!record(value) || Object.keys(value).length !== 1
    || typeof value.artifactId !== 'string' || value.artifactId.length < 1
    || value.artifactId.length > 256) {
    return { message: 'Paste Grade requires exactly one bounded artifactId.' };
  }
  return { artifactId: value.artifactId };
};
