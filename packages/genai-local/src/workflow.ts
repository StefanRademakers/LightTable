import type {
  GenAiFieldDefinition,
  GenAiModelId,
  GenAiModelSummary,
  GenAiProviderId,
  GenAiWorkflowDefinition,
  GenAiWorkflowId
} from '@lighttable/genai-core';
import type { LocalAiCapabilitiesV1, LocalAiModelCapabilityV1, LocalAiOperation } from './protocol';

export const LOCAL_AI_PROVIDER_ID = 'lighttable-local' as GenAiProviderId;

const enumField = (
  key: string,
  role: GenAiFieldDefinition['role'],
  label: string,
  values: readonly string[],
  defaultValue: string
): GenAiFieldDefinition => ({
  key, role, label, kind: 'enum', required: true, advanced: false, defaultValue,
  options: values.map((value) => ({ value, label: value })),
  sourceSchema: { type: 'string', enum: values }
});

const settingStrings = (model: LocalAiModelCapabilityV1, key: string, fallback: readonly string[]) => {
  const value = model.settings?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback;
};

export const localAiModels = (capabilities: LocalAiCapabilitiesV1): readonly GenAiModelSummary[] =>
  capabilities.models.map((model) => ({
    id: model.id as GenAiModelId,
    providerId: LOCAL_AI_PROVIDER_ID,
    label: model.name,
    ...(model.description ? { description: model.description } : {}),
    // The local HTTP protocol deliberately uses transport-level operation
    // names. The shared composer speaks UI workflow modes. Keep this mapping
    // here, at the adapter boundary, instead of leaking either vocabulary.
    capabilities: [...new Set(model.operations.map((operation) => operation === 'image.create'
      ? 'text2image'
      : operation === 'image.edit' ? 'image2image' : 'inpaint'))]
  }));

export const localAiWorkflow = (
  model: LocalAiModelCapabilityV1,
  operation: LocalAiOperation
): GenAiWorkflowDefinition => {
  if (!model.operations.includes(operation)) throw new Error(`${model.name} does not support ${operation}.`);
  const aspectRatios = settingStrings(model, 'aspectRatios', ['1:1', '16:9', '9:16', '4:3', '3:4']);
  const outputSizes = settingStrings(model, 'outputSizes', ['1K', '2K']);
  const configuredDefault = model.settings?.defaultOutputSize;
  const defaultOutputSize = typeof configuredDefault === 'string' && outputSizes.includes(configuredDefault)
    ? configuredDefault : outputSizes.at(-1) ?? '2K';
  const fields: GenAiFieldDefinition[] = [
    {
      key: 'prompt', role: 'prompt', label: 'Prompt', kind: 'string', required: true,
      advanced: false, defaultValue: '', sourceSchema: { type: 'string' }
    },
    {
      key: 'visualReferences', role: 'references', label: 'Visual references', kind: 'asset',
      required: false, advanced: false, defaultValue: [], sourceSchema: {
        type: 'array', maxItems: 10
      }
    },
    enumField('aspectRatio', 'aspect-ratio', 'Aspect ratio', aspectRatios, aspectRatios[0] ?? '1:1'),
    enumField('outputSize', 'output-size', 'Resolution', outputSizes, defaultOutputSize),
    {
      key: 'imageCount', role: 'output-count', label: 'Images', kind: 'integer', required: true,
      advanced: false, defaultValue: 1, minimum: 1, maximum: 4, step: 1,
      sourceSchema: { type: 'integer', minimum: 1, maximum: 4 }
    }
  ];
  return {
    id: `${LOCAL_AI_PROVIDER_ID}:${model.id}:${operation}` as GenAiWorkflowId,
    providerId: LOCAL_AI_PROVIDER_ID,
    modelId: model.id as GenAiModelId,
    label: model.name,
    mode: operation === 'image.create' ? 'text2image' : 'image2image',
    fields,
    sourceVersion: 'lighttable-ai-provider/1.0'
  };
};
