export const PROTOCOL_NAME = 'lighttable-ai-provider';
export const PROTOCOL_VERSION = '1.0';
export const PROVIDER_ID = 'lighttable-local';
export const PROVIDER_VERSION = '0.1.0';

export const capabilities = Object.freeze({
  protocol: { name: PROTOCOL_NAME, version: PROTOCOL_VERSION },
  provider: { id: PROVIDER_ID, name: 'Free Local AI', version: PROVIDER_VERSION },
  operations: ['image.create', 'image.edit'],
  input: {
    supportsBaseImage: true,
    supportsReferences: true,
    maxReferences: 10,
    // Selection-mask/inpainting support must only be advertised once the
    // public job contract and native backend both consume the mask. Keeping
    // this capability truthful prevents shared GenAI UI from exposing a
    // workflow that this provider cannot execute yet.
    supportsSelectionMask: false,
    selectionMaskFormats: [],
    supportedMimeTypes: ['image/png', 'image/jpeg', 'image/webp']
  },
  output: { supportedMimeTypes: ['image/png'], supportsAlpha: false, maxImagesPerJob: 4 },
  limits: { minWidth: 256, minHeight: 256, maxWidth: 2048, maxHeight: 2048, dimensionMultiple: 16 },
  models: [{
    id: 'flux-2-klein-4b',
    name: 'FLUX.2 Klein 4B',
    description: 'Local Apache-2.0 image generation and editing model.',
    operations: ['image.create', 'image.edit'],
    settings: {
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
      outputSizes: ['1K', '2K'],
      defaultOutputSize: '2K',
      steps: { default: 4, minimum: 1, maximum: 20 }
    }
  }]
});

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const validateRequest = (value) => {
  if (!isRecord(value) || !capabilities.operations.includes(value.operation)
    || typeof value.intent !== 'string' || typeof value.modelId !== 'string'
    || typeof value.prompt !== 'string' || !isRecord(value.output)) {
    throw Object.assign(new Error('Invalid LightTable AI job request.'), { code: 'INVALID_REQUEST' });
  }
  const { width, height, count, mimeType } = value.output;
  const dimensionsValid = Number.isInteger(width) && Number.isInteger(height)
    && width >= 256 && height >= 256 && width <= 2048 && height <= 2048
    && width % 16 === 0 && height % 16 === 0;
  if (!dimensionsValid || !Number.isInteger(count) || count < 1 || count > 4 || mimeType !== 'image/png') {
    throw Object.assign(new Error('Unsupported output settings.'), { code: 'INVALID_REQUEST' });
  }
  if (value.modelId !== 'flux-2-klein-4b') {
    throw Object.assign(new Error(`Model ${value.modelId} is not installed.`), { code: 'MODEL_NOT_INSTALLED' });
  }
  if (value.operation === 'image.edit' && !isRecord(value.baseImage)) {
    throw Object.assign(new Error('image.edit requires baseImage.'), { code: 'INVALID_REQUEST' });
  }
  return value;
};
