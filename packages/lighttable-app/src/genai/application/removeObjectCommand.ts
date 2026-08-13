import type {
  GenAiAssetReference,
  GenAiGenerationSubmission,
  GenAiModelSummary,
  GenAiProviderId,
  GenAiWorkflowDefinition
} from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';

export interface RemoveObjectRenderer {
  exportPng(): Promise<Blob>;
  exportSelectionMask(): Promise<Blob>;
}

export interface ExecuteRemoveObjectOptions {
  readonly service: LightTableGenAiService;
  readonly projectId: string;
  readonly renderer: RemoveObjectRenderer;
  readonly preferredProviderIds?: readonly GenAiProviderId[];
  readonly documentName: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
}

const INPAINT_CAPABILITIES = new Set(['inpaint', 'image.inpaint']);
const REMOVE_OBJECT_PROMPT = 'Remove the selected object and reconstruct the background.';

const supportsInpaint = (model: GenAiModelSummary) =>
  model.capabilities.some((capability) => INPAINT_CAPABILITIES.has(capability));

const workflowDefaults = (workflow: GenAiWorkflowDefinition) => Object.fromEntries(
  workflow.fields.map((field) => [field.key, field.defaultValue])
);

const importBlob = async (
  service: LightTableGenAiService,
  projectId: string,
  blob: Blob,
  name: string
): Promise<GenAiAssetReference> => service.importProjectAsset(projectId, {
  name,
  mediaType: 'image/png',
  bytes: new Uint8Array(await blob.arrayBuffer())
});

const inpaintTarget = async (
  service: LightTableGenAiService,
  preferredProviderIds: readonly GenAiProviderId[]
): Promise<{ providerId: GenAiProviderId; model: GenAiModelSummary; workflow: GenAiWorkflowDefinition }> => {
  const connected = (await service.getProviderSnapshots()).filter(({ status }) => status === 'connected');
  const preference = new Map(preferredProviderIds.map((id, index) => [id, index]));
  connected.sort((left, right) =>
    (preference.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (preference.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  for (const provider of connected) {
    const model = (await service.listModels(provider.id)).find(supportsInpaint);
    if (!model) continue;
    const workflow = await service.loadWorkflow(provider.id, model.id, 'image.inpaint');
    return { providerId: provider.id, model, workflow };
  }
  throw new Error('Connect an AI provider that explicitly supports Remove Object (image.inpaint).');
};

/**
 * Executes Remove Object through the generic GenAI provider boundary.
 *
 * The editor owns document/selection export; the host owns durable assets,
 * provider execution, polling and result history. The base and mask remain
 * full-document images so the existing edit-result delivery can place the
 * returned image as a registered, non-destructive layer without offsets.
 */
export const executeRemoveObject = async ({
  service,
  projectId,
  renderer,
  preferredProviderIds = [],
  documentName,
  documentWidth,
  documentHeight
}: ExecuteRemoveObjectOptions): Promise<GenAiGenerationSubmission> => {
  if (!projectId) throw new Error('Open a project before using Remove Object.');
  // Resolve capability before exporting/importing anything. A missing inpaint
  // provider must not leave orphaned base or mask assets in the project.
  const target = await inpaintTarget(service, preferredProviderIds);
  const [baseBlob, selectionBlob] = await Promise.all([
    renderer.exportPng(),
    renderer.exportSelectionMask()
  ]);
  const stamp = Date.now();
  const safeName = documentName.replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'document';
  const [base, selection] = await Promise.all([
    importBlob(service, projectId, baseBlob, `${safeName}-remove-object-base-${stamp}.png`),
    importBlob(service, projectId, selectionBlob, `${safeName}-remove-object-selection-${stamp}.png`)
  ]);
  const fields = workflowDefaults(target.workflow);
  const ratio = `${documentWidth}:${documentHeight}`;
  return service.submitGeneration(projectId, {
    providerId: target.providerId,
    modelId: target.model.id,
    workflowId: target.workflow.id,
    operation: 'image.inpaint',
    intent: 'remove-object',
    baseImageAssetId: base.id,
    selection: {
      assetId: selection.id,
      format: 'grayscale',
      interpretation: 'white-is-selected'
    },
    prompt: REMOVE_OBJECT_PROMPT,
    providerPrompt: REMOVE_OBJECT_PROMPT,
    promptBindings: [],
    output: { aspectRatio: ratio, size: '2K', count: 1 },
    fields: {
      ...fields,
      prompt: REMOVE_OBJECT_PROMPT,
      aspectRatio: ratio,
      outputSize: '2K',
      imageCount: 1
    },
    references: [base, selection]
  });
};
