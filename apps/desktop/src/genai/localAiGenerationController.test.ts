import { describe, expect, it, vi } from 'vitest';
import type { GenAiAssetReference, GenAiGenerationRequest } from '@lighttable/genai-core';
import { buildLocalAiRequest, LocalAiGenerationController } from './localAiGenerationController';

const asset = (id: string): GenAiAssetReference => ({
  id: id as GenAiAssetReference['id'], projectId: 'project', label: `${id}.png`, mediaType: 'image/png'
});
const request = (workflow: string, references: readonly GenAiAssetReference[] = []): GenAiGenerationRequest => ({
  providerId: 'lighttable-local' as GenAiGenerationRequest['providerId'],
  modelId: 'flux-2-klein-4b' as GenAiGenerationRequest['modelId'],
  workflowId: workflow as GenAiGenerationRequest['workflowId'],
  prompt: 'Original', providerPrompt: 'Resolved prompt', promptBindings: [],
  output: { aspectRatio: '16:9', size: '2K', count: 2 }, fields: { steps: 4 }, references
});

describe('LocalAiGenerationController', () => {
  it('maps create references and output intent without remote publication', () => {
    const reference = asset('first');
    const built = buildLocalAiRequest(request('lighttable-local:model:image.create', [reference]), [{
      reference, payload: { name: 'first.png', mediaType: 'image/png', bytes: new Uint8Array([1]) }
    }]);
    expect(built.request).toMatchObject({
      operation: 'image.create', prompt: 'Resolved prompt', output: { width: 2048, height: 1152, count: 2 }
    });
    expect(built.request.references?.[0]?.image.field).toBe('reference-0');
    expect(built.inputs.map(({ field }) => field)).toEqual(['reference-0']);
  });

  it('uses the first ordered image-edit reference as the base image', () => {
    const base = asset('base'); const style = asset('style');
    const resolved = [base, style].map((reference) => ({
      reference, payload: { name: reference.label, mediaType: 'image/png', bytes: new Uint8Array([1]) }
    }));
    const built = buildLocalAiRequest(request('lighttable-local:model:image.edit', [base, style]), resolved);
    expect(built.request.baseImage?.field).toBe('base-image');
    expect(built.request.references?.map(({ id }) => id)).toEqual(['style']);
    expect(built.inputs.map(({ field }) => field)).toEqual(['base-image', 'reference-0']);
  });

  it('downloads every completed result through the private provider client', async () => {
    const result = { jobId: 'job', images: [{ id: 'image', url: '/result.png', mimeType: 'image/png', width: 1, height: 1, hasAlpha: false }], generation: { providerId: 'local', providerVersion: '1', modelId: 'model' } };
    const client = { result: vi.fn().mockResolvedValue(result), downloadResult: vi.fn().mockResolvedValue(new Uint8Array([7])) };
    const controller = new LocalAiGenerationController({ clientInstance: () => client } as never);
    await expect(controller.result('job')).resolves.toMatchObject({ images: [{ width: 1, height: 1 }] });
    expect(client.downloadResult).toHaveBeenCalledWith(result, 0);
  });
});
