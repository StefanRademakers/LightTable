import { describe, expect, it, vi } from 'vitest';
import type {
  GenAiAssetId,
  GenAiModelId,
  GenAiProviderId,
  GenAiWorkflowId
} from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import { executeRemoveObject } from './removeObjectCommand';

const providerId = 'local' as GenAiProviderId;
const modelId = 'model' as GenAiModelId;
const workflowId = 'local:model:image.inpaint' as GenAiWorkflowId;

describe('executeRemoveObject', () => {
  it('submits a full-frame base and selection through an explicit inpaint workflow', async () => {
    let imported = 0;
    const service = {
      getProviderSnapshots: vi.fn(async () => [{ id: providerId, label: 'Local', status: 'connected' }]),
      listModels: vi.fn(async () => [{ id: modelId, providerId, label: 'Model', capabilities: ['inpaint'] }]),
      loadWorkflow: vi.fn(async () => ({
        id: workflowId, providerId, modelId, label: 'Model', mode: 'image2image', fields: [
          { key: 'steps', label: 'Steps', kind: 'integer', required: false, advanced: true,
            defaultValue: 4, sourceSchema: { type: 'integer' } }
        ]
      })),
      importProjectAsset: vi.fn(async (_projectId: string, payload: { name: string }) => ({
        id: `asset-${++imported}` as GenAiAssetId,
        projectId: 'project', label: payload.name, mediaType: 'image/png'
      })),
      submitGeneration: vi.fn(async () => ({
        jobId: 'job', providerJobId: 'provider-job', status: 'submitted'
      }))
    } as unknown as LightTableGenAiService;
    const editorDelivery = { projectId: 'project', documentId: 'document', sourceRevision: 42, behavior: 'place-edit' as const };
    const prepareSource = vi.fn(async () => ({
      baseBlob: new Blob(['base'], { type: 'image/png' }), selectionBlob: new Blob(['mask'], { type: 'image/png' }),
      documentName: 'Test image', width: 1920, height: 1080, editorDelivery, assertCurrent: () => {}
    }));

    await executeRemoveObject({
      service, projectId: 'project', prepareSource, assertCurrent: () => {}, preferredProviderIds: [providerId]
    });

    expect(service.importProjectAsset).toHaveBeenCalledTimes(2);
    expect(service.loadWorkflow).toHaveBeenCalledWith(providerId, modelId, 'image.inpaint');
    expect(service.submitGeneration).toHaveBeenCalledWith('project', expect.objectContaining({
      operation: 'image.inpaint', intent: 'remove-object', baseImageAssetId: 'asset-1',
      editorDelivery, output: { aspectRatio: '1920:1080', size: '2K', count: 1 },
      fields: expect.objectContaining({ steps: 4, aspectRatio: '1920:1080', imageCount: 1 }),
      selection: { assetId: 'asset-2', format: 'grayscale', interpretation: 'white-is-selected' },
      references: [expect.objectContaining({ id: 'asset-1' }), expect.objectContaining({ id: 'asset-2' })]
    }));
  });

  it('does not silently fall back to a provider without inpaint support', async () => {
    const service = {
      getProviderSnapshots: vi.fn(async () => [{ id: providerId, label: 'Cloud', status: 'connected' }]),
      listModels: vi.fn(async () => [{ id: modelId, providerId, label: 'Model', capabilities: ['image2image'] }]),
      importProjectAsset: vi.fn(async (_projectId: string, payload: { name: string }) => ({
        id: payload.name as GenAiAssetId, projectId: 'project', label: payload.name, mediaType: 'image/png'
      }))
    } as unknown as LightTableGenAiService;
    const prepareSource = vi.fn(async () => { throw new Error('Unexpected source capture'); });
    await expect(executeRemoveObject({
      service, projectId: 'project', prepareSource, assertCurrent: () => {}
    })).rejects.toThrow('explicitly supports Remove Object');
    expect(prepareSource).not.toHaveBeenCalled();
    expect(service.importProjectAsset).not.toHaveBeenCalled();
  });
});
