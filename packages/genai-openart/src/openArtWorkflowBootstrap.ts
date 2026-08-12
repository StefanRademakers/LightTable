import type {
  GenAiFieldDefinition,
  GenAiModelId,
  GenAiProviderId,
  GenAiWorkflowDefinition,
  GenAiWorkflowId
} from '@lighttable/genai-core';

const providerId = 'openart' as GenAiProviderId;
const aspectRatios = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];

const optionLabel = (value: string): string => {
  if (/^\d+k$/iu.test(value)) return value.toUpperCase();
  return value.length ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
};

const enumField = (
  key: string,
  role: GenAiFieldDefinition['role'],
  label: string,
  options: readonly string[],
  defaultValue: string
): GenAiFieldDefinition => ({
  key, role, label, kind: 'enum', required: true, advanced: false, defaultValue,
  options: options.map((value) => ({ value, label: optionLabel(value) })),
  sourceSchema: { type: 'string', enum: options, default: defaultValue }
});

/**
 * Last-known provider contracts used only when live discovery and the disk
 * cache cannot supply a usable form. These live in the OpenArt adapter (never
 * React), retain provider keys and are replaced by a valid live schema.
 */
export const openArtBootstrapWorkflow = (
  modelId: GenAiModelId,
  mode: string
): GenAiWorkflowDefinition | undefined => {
  if (modelId !== 'nano-banana-pro' && modelId !== 'gpt-image-2') return undefined;
  const fields: GenAiFieldDefinition[] = [
    {
      key: 'prompt', role: 'prompt', label: 'Prompt', kind: 'string', required: true,
      advanced: false, sourceSchema: { type: 'string', minLength: 1 }
    },
    {
      key: 'imageCount', role: 'output-count', label: 'Images', kind: 'integer', required: true,
      advanced: false, defaultValue: 1, minimum: 1, maximum: 4,
      sourceSchema: { type: 'integer', minimum: 1, maximum: 4, default: 1 }
    },
    enumField('aspectRatio', 'aspect-ratio', 'Aspect ratio', aspectRatios, modelId === 'gpt-image-2' ? '4:3' : '1:1'),
    modelId === 'gpt-image-2'
      ? enumField('resolutionTier', 'output-size', 'Size', ['1k', '2k', '4k'], '2k')
      : enumField('resolution', 'output-size', 'Size', ['1K', '2K', '4K'], '1K')
  ];
  if (modelId === 'gpt-image-2') {
    fields.push(enumField('quality', 'quality', 'Quality', ['low', 'medium', 'high', 'auto'], 'medium'));
  }
  if (mode === 'image2image') {
    fields.push({
      key: 'visualReferences', role: 'references', label: 'Visual references', kind: 'asset',
      required: true, advanced: false,
      sourceSchema: { type: 'array', minItems: 1, maxItems: modelId === 'nano-banana-pro' ? 14 : 10 }
    });
  }
  return {
    id: `openart:${modelId}:${mode}` as GenAiWorkflowId,
    providerId,
    modelId,
    mode,
    label: mode === 'text2image' ? 'Text to image' : 'Image to image',
    fields
  };
};
