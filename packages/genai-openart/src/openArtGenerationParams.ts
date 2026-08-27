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
  // Media fields are reconstructed from desktop-published provider URLs below.
  // Never leak renderer-side asset objects or arrays into the provider form.
  for (const field of workflow.fields) if (field.kind === 'asset') delete params[field.key];
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

  const firstFrameField = workflow.fields.find((field) => field.role === 'first-frame')?.key;
  const lastFrameField = workflow.fields.find((field) => field.role === 'last-frame')?.key;
  const referenceField = workflow.fields.find((field) => field.role === 'references')?.key;
  const firstFrame = request.references.find(({ purpose }) => purpose === 'first_frame');
  const lastFrame = request.references.find(({ purpose }) => purpose === 'last_frame');
  const byRequestId = new Map(request.references.map((reference, index) => [reference.id, providerReferences[index]!]));
  if (firstFrameField && firstFrame) params[firstFrameField] = byRequestId.get(firstFrame.id);
  if (lastFrameField && lastFrame) params[lastFrameField] = byRequestId.get(lastFrame.id);

  if (referenceField) {
    params[referenceField] = providerReferences.filter((_reference, index) => {
      const purpose = request.references[index]?.purpose;
      return (purpose !== 'first_frame' || !firstFrameField) && (purpose !== 'last_frame' || !lastFrameField);
    });
  } else if (!firstFrameField && !lastFrameField) {
    throw new Error(`${workflow.label} does not accept visual references.`);
  }
  return params;
};
