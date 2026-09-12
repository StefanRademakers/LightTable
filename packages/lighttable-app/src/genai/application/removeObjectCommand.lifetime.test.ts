import { describe, expect, it, vi } from 'vitest';
import type { GenAiAssetId, GenAiModelId, GenAiProviderId, GenAiWorkflowId } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import { executeRemoveObject, type RemoveObjectSource } from './removeObjectCommand';

const providerId = 'local' as GenAiProviderId;
const modelId = 'model' as GenAiModelId;
const workflowId = 'local:model:image.inpaint' as GenAiWorkflowId;
type Stage = 'providers' | 'models' | 'workflow' | 'capture' | 'base-bytes' | 'mask-bytes'
  | 'base-import' | 'mask-import' | 'submit';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const setup = (stage?: Stage) => {
  const reached = deferred(), resume = deferred();
  const pause = async (at: Stage) => {
    if (stage === at) { reached.resolve(); await resume.promise; }
  };
  let scopeCurrent = true, sourceCurrent = true;
  const assertCurrent = () => { if (!scopeCurrent) throw new Error('Original request retired.'); };
  const assertSource = () => { if (!sourceCurrent) throw new Error('Captured source changed.'); };
  const blob = (name: 'base' | 'mask') => {
    const result = new Blob([name], { type: 'image/png' });
    const read = result.arrayBuffer.bind(result);
    vi.spyOn(result, 'arrayBuffer').mockImplementation(async () => { await pause(`${name}-bytes`); return read(); });
    return result;
  };
  const source: RemoveObjectSource = {
    baseBlob: blob('base'), selectionBlob: blob('mask'), documentName: 'Test image',
    width: 1920, height: 1080,
    editorDelivery: { projectId: 'project', documentId: 'document', sourceRevision: 42, behavior: 'place-edit' },
    assertCurrent: assertSource
  };
  const imported: { projectId: string; name: string; bytes: Uint8Array }[] = [];
  const service = {
    getProviderSnapshots: vi.fn(async () => {
      await pause('providers'); return [{ id: providerId, label: 'Local', status: 'connected' }];
    }),
    listModels: vi.fn(async () => {
      await pause('models'); return [{ id: modelId, providerId, label: 'Model', capabilities: ['inpaint'] }];
    }),
    loadWorkflow: vi.fn(async () => {
      await pause('workflow'); return { id: workflowId, providerId, modelId, label: 'Model', mode: 'image2image', fields: [] };
    }),
    importProjectAsset: vi.fn(async (projectId: string, payload: { name: string; bytes: Uint8Array }) => {
      const kind = payload.name.includes('-base-') ? 'base' : 'mask';
      imported.push({ projectId, ...payload });
      await pause(`${kind}-import`);
      return { id: kind as GenAiAssetId, projectId, label: payload.name, mediaType: 'image/png' };
    }),
    submitGeneration: vi.fn(async () => {
      await pause('submit'); return { jobId: 'job', providerJobId: 'provider-job', status: 'submitted' };
    })
  };
  const prepareSource = vi.fn(async () => { await pause('capture'); return source; });
  const options = { service: service as unknown as LightTableGenAiService, projectId: 'project',
    preferredProviderIds: [providerId], prepareSource, assertCurrent };
  return { source, service, prepareSource, options, imported, reached: reached.promise, resume: resume.resolve,
    retire: () => { scopeCurrent = false; }, changeSource: () => { sourceCurrent = false; } };
};

describe('Remove Object request lifetime', () => {
  it('rejects an already retired request before discovery', async () => {
    const f = setup(); f.retire();
    await expect(executeRemoveObject(f.options)).rejects.toThrow('Original request retired');
    expect(f.service.getProviderSnapshots).not.toHaveBeenCalled();
  });
  it.each(['providers', 'models', 'workflow', 'capture'] as const)('stops retirement during %s before imports', async stage => {
    const f = setup(stage), pending = executeRemoveObject(f.options);
    const rejected = expect(pending).rejects.toThrow('Original request retired');
    await f.reached; f.retire(); f.resume(); await rejected;
    expect(f.service.importProjectAsset).not.toHaveBeenCalled();
    expect(f.service.submitGeneration).not.toHaveBeenCalled();
    if (stage !== 'capture') expect(f.prepareSource).not.toHaveBeenCalled();
    if (stage === 'providers') expect(f.service.listModels).not.toHaveBeenCalled();
    if (stage === 'models') expect(f.service.loadWorkflow).not.toHaveBeenCalled();
  });
  it.each(['base-bytes', 'mask-bytes', 'base-import', 'mask-import'] as const)('rejects source change during %s without submission', async stage => {
    const f = setup(stage), pending = executeRemoveObject(f.options);
    const rejected = expect(pending).rejects.toThrow('Captured source changed');
    await f.reached; f.changeSource(); f.resume(); await rejected;
    expect(f.service.submitGeneration).not.toHaveBeenCalled();
    expect(f.imported.every(asset => asset.projectId === 'project')).toBe(true);
    if (stage.endsWith('-bytes')) {
      const target = stage.startsWith('base') ? '-base-' : '-selection-';
      expect(f.imported.some(asset => asset.name.includes(target))).toBe(false);
    } else expect(f.imported).toHaveLength(2);
  });
  it('pins original-project imports when the request retires during import', async () => {
    const f = setup('base-import'), pending = executeRemoveObject(f.options);
    const rejected = expect(pending).rejects.toThrow('Original request retired');
    await f.reached; f.options.projectId = 'successor'; f.retire(); f.resume(); await rejected;
    expect(f.imported).toHaveLength(2);
    expect(f.imported.every(asset => asset.projectId === 'project')).toBe(true);
    expect(f.service.submitGeneration).not.toHaveBeenCalled();
  });
  it('rejects a source already superseded when capture returns before reading bytes', async () => {
    const f = setup('capture'), pending = executeRemoveObject(f.options);
    const rejected = expect(pending).rejects.toThrow('Captured source changed');
    await f.reached; f.changeSource(); f.resume(); await rejected;
    expect(f.source.baseBlob.arrayBuffer).not.toHaveBeenCalled();
    expect(f.source.selectionBlob.arrayBuffer).not.toHaveBeenCalled();
    expect(f.service.importProjectAsset).not.toHaveBeenCalled();
  });
  it('preserves captured provenance and bytes through asynchronous imports', async () => {
    const f = setup('base-import'), delivery = { ...f.source.editorDelivery };
    const pending = executeRemoveObject(f.options);
    await f.reached;
    // Captured request values cannot be replaced by later caller-owned objects.
    Object.assign(f.source.editorDelivery, { sourceRevision: 99 });
    f.options.projectId = 'successor'; f.resume();
    await pending;
    expect(f.service.submitGeneration).toHaveBeenCalledExactlyOnceWith('project', expect.objectContaining({ editorDelivery: delivery }));
    expect(f.imported.map(asset => [asset.projectId, new TextDecoder().decode(asset.bytes)]))
      .toEqual([['project', 'base'], ['project', 'mask']]);
  });
  it('does not cancel or resubmit an already dispatched job when its UI retires', async () => {
    const f = setup('submit'), pending = executeRemoveObject(f.options);
    await f.reached; f.retire(); f.resume();
    await expect(pending).resolves.toMatchObject({ jobId: 'job' });
    expect(f.service.submitGeneration).toHaveBeenCalledOnce();
  });
  it('surfaces current provider failure without capture, fallback or retry', async () => {
    const f = setup(); f.service.loadWorkflow.mockRejectedValue(new Error('Provider unavailable'));
    await expect(executeRemoveObject(f.options)).rejects.toThrow('Provider unavailable');
    expect(f.service.loadWorkflow).toHaveBeenCalledOnce();
    expect(f.prepareSource).not.toHaveBeenCalled();
  });
  it('surfaces current durable import failure without submitting or retrying', async () => {
    const f = setup(); f.service.importProjectAsset.mockRejectedValue(new Error('Asset storage failed'));
    await expect(executeRemoveObject(f.options)).rejects.toThrow('Asset storage failed');
    expect(f.service.importProjectAsset).toHaveBeenCalledTimes(2);
    expect(f.service.submitGeneration).not.toHaveBeenCalled();
  });
  it.each(['projectId', 'behavior'] as const)('rejects incompatible source delivery %s before importing', field => {
    const f = setup(); Object.assign(f.source.editorDelivery, { [field]: field === 'projectId' ? 'foreign' : 'open-new' });
    return expect(executeRemoveObject(f.options)).rejects.toThrow('incompatible editor delivery').then(() => {
      expect(f.service.importProjectAsset).not.toHaveBeenCalled(); expect(f.service.submitGeneration).not.toHaveBeenCalled();
    });
  });
  it.each(['base', 'mask'] as const)('rejects a foreign-project %s asset without submitting', async foreign => {
    const f = setup();
    f.service.importProjectAsset.mockImplementation(async (projectId, payload) => {
      const kind = payload.name.includes('-base-') ? 'base' : 'mask';
      return { id: kind as GenAiAssetId, projectId: kind === foreign ? 'foreign' : projectId,
        label: payload.name, mediaType: 'image/png' };
    });
    await expect(executeRemoveObject(f.options)).rejects.toThrow('asset belongs to a different project');
    expect(f.service.submitGeneration).not.toHaveBeenCalled();
  });
});
