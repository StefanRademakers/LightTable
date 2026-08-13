import { describe, expect, it } from 'vitest';
import type { LocalAiCapabilitiesV1 } from './protocol';
import { localAiModels, localAiWorkflow, LOCAL_AI_PROVIDER_ID } from './workflow';

const capabilities: LocalAiCapabilitiesV1 = {
  protocol: { name: 'lighttable-ai-provider', version: '1.0' },
  provider: { id: 'runtime-specific-id', name: 'Free Local AI', version: '0.1.0' },
  operations: ['image.create', 'image.edit'],
  input: { supportsBaseImage: true, supportsReferences: true, maxReferences: 10,
    supportsSelectionMask: true, selectionMaskFormats: ['alpha'], supportedMimeTypes: ['image/png'] },
  output: { supportedMimeTypes: ['image/png'], supportsAlpha: false, maxImagesPerJob: 4 },
  limits: { minWidth: 256, minHeight: 256, maxWidth: 2048, maxHeight: 2048 },
  models: [{ id: 'flux', name: 'FLUX', operations: ['image.create', 'image.edit'], settings: {
    aspectRatios: ['1:1', '16:9'], outputSizes: ['1K', '2K'], defaultOutputSize: '2K'
  } }]
};

describe('local AI capability mapping', () => {
  it('keeps the LightTable provider identity stable and lets capabilities drive the shared UI', () => {
    expect(localAiModels(capabilities)[0]).toMatchObject({ providerId: LOCAL_AI_PROVIDER_ID, id: 'flux' });
    const workflow = localAiWorkflow(capabilities.models[0]!, 'image.edit');
    expect(workflow.mode).toBe('image2image');
    expect(workflow.fields.find(({ role }) => role === 'output-size')?.defaultValue).toBe('2K');
    expect(workflow.fields.find(({ role }) => role === 'references')?.kind).toBe('asset');
  });
});
