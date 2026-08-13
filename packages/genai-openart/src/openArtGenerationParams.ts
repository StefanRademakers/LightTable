import type { GenAiGenerationRequest, GenAiWorkflowDefinition } from '@lighttable/genai-core';

export interface OpenArtResolvedReference {
  readonly assetId: string;
  readonly url: string;
  readonly mediaType: string;
}

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
  const promptField = workflow.fields.find((field) => field.role === 'prompt')?.key ?? 'prompt';
  const params: Record<string, unknown> = { ...request.fields, [promptField]: request.providerPrompt };
  if (!request.references.length) return params;

  const byAssetId = new Map(resolvedReferences.map((reference) => [reference.assetId, reference]));
  const bindingByAssetId = new Map(request.promptBindings.map((binding) => [binding.assetId, binding]));

  /**
   * ARCHITECTURAL INVARIANT — DO NOT derive this list from promptBindings.
   *
   * `request.references` is the authoritative state of the Visual References
   * widget. Every asset selected there must be published and sent to OpenArt,
   * even when the prompt never mentions its @token. `promptBindings` is only
   * optional naming metadata used to assign the provider-facing image alias;
   * it must never add, remove, or filter visual references.
   */
  const providerReferences = request.references.map((asset, index) => {
    const reference = byAssetId.get(asset.id);
    const binding = bindingByAssetId.get(asset.id);
    if (!reference) {
      throw new Error(`Reference ${binding?.token ?? asset.label} has no reachable provider URL.`);
    }
    const label = (binding?.providerLabel ?? `@image${index + 1}`).replace(/^@/u, '');
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

  const referenceField = workflow.fields.find((field) => field.role === 'references')?.key;
  if (!referenceField) {
    throw new Error(`${workflow.label} does not accept visual references.`);
  }
  params[referenceField] = providerReferences;
  return params;
};
