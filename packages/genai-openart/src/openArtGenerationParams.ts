import type { GenAiGenerationRequest, GenAiWorkflowDefinition } from '@lighttable/genai-core';

export interface OpenArtResolvedReference {
  readonly assetId: string;
  readonly url: string;
  readonly mediaType: string;
}

const REFERENCE_FIELD_CANDIDATES = ['visualReferences', 'references', 'images', 'inputImages'] as const;

/**
 * Builds the provider form payload only after the desktop host has published
 * local references to reachable HTTPS URLs. Local paths never enter this
 * payload and references are never silently omitted.
 */
export const buildOpenArtGenerationParams = (
  request: GenAiGenerationRequest,
  workflow: GenAiWorkflowDefinition,
  resolvedReferences: readonly OpenArtResolvedReference[]
): Readonly<Record<string, unknown>> => {
  const params: Record<string, unknown> = { ...request.fields, prompt: request.providerPrompt };
  if (!request.references.length) return params;

  const byAssetId = new Map(resolvedReferences.map((reference) => [reference.assetId, reference]));
  const providerReferences = request.promptBindings.map((binding) => {
    const reference = byAssetId.get(binding.assetId);
    if (!reference) throw new Error(`Reference ${binding.token} has no reachable provider URL.`);
    const label = (binding.providerLabel ?? binding.token).replace(/^@/u, '');
    return {
      type: reference.mediaType.startsWith('video/')
        ? 'video'
        : reference.mediaType.startsWith('audio/')
          ? 'audio'
          : 'image',
      id: label,
      url: reference.url,
      label
    };
  });

  const referenceField = REFERENCE_FIELD_CANDIDATES.find((key) =>
    workflow.fields.some((field) => field.key === key && field.kind === 'asset')
  );
  if (!referenceField) {
    throw new Error(`${workflow.label} does not accept visual references.`);
  }
  params[referenceField] = providerReferences;
  return params;
};
