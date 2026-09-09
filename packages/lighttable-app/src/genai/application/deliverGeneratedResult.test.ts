import { describe, expect, it, vi } from 'vitest';
import type { GenAiGenerationJob } from '@lighttable/genai-core';
import type { DocumentSessionId } from '../../lighttable/application/documents/documentSession';
import { DocumentTaskRegistry } from '../../lighttable/application/tasks/documentTaskRegistry';
import { deliverGeneratedResult } from './deliverGeneratedResult';

const documentId = 'document-ai' as DocumentSessionId;
const job = (operation: 'image.edit' | 'image.create' = 'image.edit'): GenAiGenerationJob => ({
  id: 'job-1' as GenAiGenerationJob['id'],
  request: {
    providerId: 'provider' as GenAiGenerationJob['request']['providerId'],
    modelId: 'model' as GenAiGenerationJob['request']['modelId'],
    workflowId: operation as GenAiGenerationJob['request']['workflowId'],
    operation,
    editorDelivery: {
      projectId: 'project', documentId, sourceRevision: 3,
      behavior: operation === 'image.edit' ? 'place-edit' : 'open-new'
    },
    prompt: 'Prompt', providerPrompt: 'Prompt', promptBindings: [], fields: {}, references: []
  },
  status: 'succeeded', createdAt: 1, updatedAt: 2,
  results: [{ assetId: 'asset-1' as GenAiGenerationJob['results'][number]['assetId'], mediaType: 'image/png' }]
});

const payload = {
  bytes: Uint8Array.from([137, 80, 78, 71]),
  name: 'generated.png',
  mediaType: 'image/png'
};

const driver = () => ({
  registerInputArtifact: vi.fn(() => ({
    id: 'artifact-1', kind: 'input' as const, name: payload.name,
    mediaType: payload.mediaType, byteLength: payload.bytes.length, createdAt: 1
  })),
  execute: vi.fn(async () => ({
    requestId: 'place', status: 'completed' as const,
    value: { layerId: 'generated-layer' }, revisions: { workspace: 1 }
  })),
  releaseArtifact: vi.fn(() => true)
});

describe('deliverGeneratedResult', () => {
  it('places an image edit through the transient UI command owner', async () => {
    const tasks = new DocumentTaskRegistry(documentId);
    const commandDriver = driver();
    const openDocument = vi.fn(async () => undefined);

    await expect(deliverGeneratedResult({
      job: job(), projectId: 'project', service: { loadProjectAsset: vi.fn(async () => payload) },
      tasks, commandDriver, documentId, documentIsImage: true,
      isCurrent: () => true, openDocument
    })).resolves.toBe(true);

    expect(commandDriver.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'layer.placeArtifact', documentId,
      parameters: { artifactId: 'artifact-1' }
    }), { origin: 'ui', recording: 'ignore' });
    expect(commandDriver.releaseArtifact).toHaveBeenCalledWith('artifact-1');
    expect(openDocument).not.toHaveBeenCalled();
    expect(tasks.getSnapshot().activeTaskIds).toEqual([]);
  });

  it('cancels after asset loading when the originating document is no longer current', async () => {
    const tasks = new DocumentTaskRegistry(documentId);
    const commandDriver = driver();
    let current = true;
    let resolvePayload: (value: typeof payload) => void = () => {};
    const loadProjectAsset = vi.fn(() => new Promise<typeof payload>((resolve) => {
      resolvePayload = resolve;
    }));
    const delivery = deliverGeneratedResult({
      job: job(), projectId: 'project', service: { loadProjectAsset }, tasks,
      commandDriver, documentId, documentIsImage: true,
      isCurrent: () => current, openDocument: vi.fn()
    });

    current = false;
    resolvePayload(payload);
    await expect(delivery).resolves.toBe(false);
    expect(commandDriver.registerInputArtifact).not.toHaveBeenCalled();
    expect(commandDriver.execute).not.toHaveBeenCalled();
  });

  it('never places an edit into a different active document or project', async () => {
    const tasks = new DocumentTaskRegistry(documentId);
    const commandDriver = driver();
    const wrongTarget = {
      ...job(),
      request: {
        ...job().request,
        editorDelivery: {
          projectId: 'project', documentId: 'document-original', sourceRevision: 3,
          behavior: 'place-edit' as const
        }
      }
    };

    await expect(deliverGeneratedResult({
      job: wrongTarget, projectId: 'project',
      service: { loadProjectAsset: vi.fn(async () => payload) }, tasks,
      commandDriver, documentId, documentIsImage: true,
      isCurrent: () => true, openDocument: vi.fn()
    })).resolves.toBe(false);
    expect(commandDriver.execute).not.toHaveBeenCalled();
  });

  it('opens create results as a new document instead of mutating the source document', async () => {
    const tasks = new DocumentTaskRegistry(documentId);
    const commandDriver = driver();
    const openDocument = vi.fn(async () => undefined);

    await expect(deliverGeneratedResult({
      job: job('image.create'), projectId: 'project',
      service: { loadProjectAsset: vi.fn(async () => payload) }, tasks,
      commandDriver, documentId, documentIsImage: true,
      isCurrent: () => true, openDocument
    })).resolves.toBe(true);

    expect(openDocument).toHaveBeenCalledWith(expect.objectContaining({ name: 'generated.png' }));
    expect(commandDriver.execute).not.toHaveBeenCalled();
  });

  it('never loads or opens an automatic create result in a different active project', async () => {
    const tasks = new DocumentTaskRegistry(documentId);
    const commandDriver = driver();
    const loadProjectAsset = vi.fn(async () => payload);
    const openDocument = vi.fn(async () => undefined);

    await expect(deliverGeneratedResult({
      job: job('image.create'), projectId: 'project-other',
      service: { loadProjectAsset }, tasks,
      commandDriver, documentId, documentIsImage: true,
      isCurrent: () => true, openDocument
    })).resolves.toBe(false);

    expect(loadProjectAsset).not.toHaveBeenCalled();
    expect(openDocument).not.toHaveBeenCalled();
    expect(commandDriver.execute).not.toHaveBeenCalled();
  });

  it('keeps legacy jobs without delivery provenance explicit-only', async () => {
    const tasks = new DocumentTaskRegistry(documentId);
    const commandDriver = driver();
    const loadProjectAsset = vi.fn(async () => payload);
    const legacyJob = {
      ...job('image.create'),
      request: { ...job('image.create').request, editorDelivery: undefined }
    };

    await expect(deliverGeneratedResult({
      job: legacyJob, projectId: 'project', service: { loadProjectAsset }, tasks,
      commandDriver, documentId, documentIsImage: true,
      isCurrent: () => true, openDocument: vi.fn()
    })).resolves.toBe(false);

    expect(loadProjectAsset).not.toHaveBeenCalled();
  });

  it('reports a rejected or failed Open terminal instead of completing delivery', async () => {
    const tasks = new DocumentTaskRegistry(documentId);
    const commandDriver = driver();

    await expect(deliverGeneratedResult({
      job: job('image.create'), projectId: 'project',
      service: { loadProjectAsset: vi.fn(async () => payload) }, tasks,
      commandDriver, documentId, documentIsImage: true,
      isCurrent: () => true,
      openDocument: async () => { throw new Error('decode failed'); }
    })).rejects.toThrow('decode failed');

    expect(tasks.getSnapshot().activeTaskIds).toEqual([]);
    expect(Object.values(tasks.getSnapshot().tasks).at(-1)).toMatchObject({
      status: 'failed', error: 'decode failed'
    });
  });
});
