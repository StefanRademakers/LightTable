import { describe, expect, it, vi } from 'vitest';
import type { GenAiAssetId, GenAiAssetReference, GenAiWorkflowDefinition } from '@lighttable/genai-core';
import { createGenAiAssetReferenceImport, type GenAiAssetReferenceImportPorts } from './GenAiAssetReferenceImport';

const workflow: GenAiWorkflowDefinition = { id: 'workflow' as GenAiWorkflowDefinition['id'],
  modelId: 'model' as GenAiWorkflowDefinition['modelId'], providerId: 'provider' as GenAiWorkflowDefinition['providerId'],
  mode: 'image2image', label: 'Edit', fields: [{ key: 'references', kind: 'asset', role: 'references',
    label: 'References', required: false, advanced: false, sourceSchema: {} }] };
const asset = { id: 'asset' as GenAiAssetId, projectId: 'project-a', label: 'Image', mediaType: 'image/png' };
const deferred = <T>() => {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
};
const tick = async () => { for (let index = 0; index < 4; index++) await Promise.resolve(); };
const fixture = (projectId: string | undefined = 'project-a', delayed = false) => {
  let current = true;
  const state = { assets: [] as readonly GenAiAssetReference[], values: { prompt: 'Preserve prompt' } as Readonly<Record<string, unknown>>,
    previews: {} as Readonly<Record<string, string>>, error: undefined as string | undefined };
  const updates: (() => void)[] = [];
  const apply = (work: () => void) => delayed ? updates.push(work) : work();
  const ports: GenAiAssetReferenceImportPorts = {
    updateAssets: change => { apply(() => { state.assets = change(state.assets); }); },
    updateValues: change => { apply(() => { state.values = change(state.values); }); },
    updatePreviews: change => { apply(() => { state.previews = change(state.previews); }); },
    updateError: change => { apply(() => { state.error = change(state.error); }); },
    readLocalPreview: vi.fn(async () => 'data:image/png;base64,local')
  };
  const service = { importProjectAsset: vi.fn(async () => asset), loadProjectAssetPreview: vi.fn(async (): Promise<string | null> => 'preview') };
  const file = { name: 'Image.png', type: 'image/png', size: 8,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) } as unknown as File;
  const target = { service, projectId, workflow, isCurrent: () => current };
  return { state, ports, service, file, target, lease: createGenAiAssetReferenceImport(target, ports),
    retire: () => { current = false; }, flush: () => { for (const update of updates.splice(0)) update(); } };
};

describe('captured GenAI asset reference import', () => {
  it('imports through the original project host and reuses reference assignment without changing the prompt', async () => {
    const f = fixture();
    expect(await f.lease.importFile(f.file)).toEqual(asset);
    expect(f.service.importProjectAsset).toHaveBeenCalledWith('project-a', {
      name: 'Image.png', mediaType: 'image/png', bytes: new Uint8Array(8) });
    expect(f.state.assets).toEqual([asset]);
    expect(f.state.values).toEqual({ prompt: 'Preserve prompt', references: [asset] });
    await f.lease.importFile(f.file);
    expect(f.state.assets).toEqual([asset]); expect(f.state.values.references).toEqual([asset]);
  });
  it('rejects retirement before file read without clearing current errors', async () => {
    const f = fixture(); f.state.error = 'Current error'; f.retire();
    expect(await f.lease.importFile(f.file)).toBeUndefined();
    expect(f.file.arrayBuffer).not.toHaveBeenCalled(); expect(f.service.importProjectAsset).not.toHaveBeenCalled();
    expect(f.state.error).toBe('Current error');
  });
  it('rejects a host result for a different project before attachment', async () => {
    const f = fixture(); f.service.importProjectAsset.mockResolvedValue({ ...asset, projectId: 'project-b' });
    expect(await f.lease.importFile(f.file)).toBeUndefined();
    expect(f.state.assets).toEqual([]); expect(f.state.values.references).toBeUndefined();
    expect(f.state.error).toContain('captured project');
  });
  it('rejects after deferred file read before any project write', async () => {
    const f = fixture(); const read = deferred<ArrayBuffer>(); vi.mocked(f.file.arrayBuffer).mockReturnValue(read.promise);
    const importing = f.lease.importFile(f.file); f.retire(); read.resolve(new ArrayBuffer(8));
    expect(await importing).toBeUndefined(); expect(f.service.importProjectAsset).not.toHaveBeenCalled();
  });
  it('does not attach a durable original-project asset after request retirement', async () => {
    const f = fixture(); const imported = deferred<GenAiAssetReference>(); f.service.importProjectAsset.mockReturnValue(imported.promise);
    const importing = f.lease.importFile(f.file); await tick();
    expect(f.service.importProjectAsset).toHaveBeenCalledOnce();
    f.retire(); imported.resolve(asset); expect(await importing).toBeUndefined();
    expect(f.state.assets).toEqual([]); expect(f.state.values.references).toBeUndefined();
    // There is deliberately no delete/rollback service port: the imported library asset remains durable.
  });
  it('guards inside deferred assets, references, previews and error updaters', async () => {
    const f = fixture('project-a', true);
    await f.lease.importFile(f.file); await f.lease.requestPreview(asset.id);
    f.retire(); const before = { assets: f.state.assets, values: f.state.values, previews: f.state.previews };
    f.state.error = 'Successor error'; f.flush();
    expect(f.state.assets).toBe(before.assets); expect(f.state.values).toBe(before.values);
    expect(f.state.previews).toBe(before.previews); expect(f.state.error).toBe('Successor error');
  });
  it('prepares a standalone preview before publishing the local attachment', async () => {
    const f = fixture(''); const preview = deferred<string>(); vi.mocked(f.ports.readLocalPreview).mockReturnValue(preview.promise);
    const importing = f.lease.importFile(f.file); expect(f.state.assets).toEqual([]);
    preview.resolve('data:image/png;base64,local'); const imported = await importing;
    expect(imported?.projectId).toBe(''); expect(f.state.previews[imported!.id]).toBe('data:image/png;base64,local');
    expect(f.state.values.references).toEqual([imported]); expect(f.service.importProjectAsset).not.toHaveBeenCalled();
  });
  it('does not leave a standalone attachment when local preview preparation fails', async () => {
    const f = fixture(''); vi.mocked(f.ports.readLocalPreview).mockRejectedValue(new Error('Read failed'));
    expect(await f.lease.importFile(f.file)).toBeUndefined(); expect(f.state.assets).toEqual([]);
    expect(f.state.error).toBe('Read failed');
  });
  it('rejects oversized files before reading and preserves the host-unavailable message', async () => {
    const f = fixture();
    expect(await f.lease.importFile({ ...f.file, size: 256 * 1024 * 1024 + 1 })).toBeUndefined();
    expect(f.file.arrayBuffer).not.toHaveBeenCalled(); expect(f.state.error).toContain('256 MiB');
    const missing = createGenAiAssetReferenceImport({ ...f.target, service: undefined }, f.ports);
    await missing.importFile(f.file); expect(f.state.error).toBe('Local media references are unavailable in this host.');
  });
  it('reports current import errors while retired errors cannot overwrite successor state', async () => {
    const f = fixture(); f.service.importProjectAsset.mockRejectedValueOnce(new Error("No handler registered for 'lighttable:genai-project-asset-import'"));
    await f.lease.importFile(f.file); expect(f.state.error).toContain('Restart the LightTable');
    const pending = deferred<GenAiAssetReference>(); f.service.importProjectAsset.mockReturnValue(pending.promise);
    const importing = f.lease.importFile(f.file); await tick(); f.retire(); f.state.error = 'Successor';
    pending.reject(new Error('Old host failed')); await importing; expect(f.state.error).toBe('Successor');
  });
  it('scopes optional preview delivery without shared request bookkeeping', async () => {
    const f = fixture(); const preview = deferred<string>(); f.service.loadProjectAssetPreview.mockReturnValue(preview.promise);
    const reading = f.lease.requestPreview(asset.id); f.retire(); f.state.previews = { [asset.id]: 'Successor preview' };
    preview.resolve('Old preview'); await reading; expect(f.state.previews[asset.id]).toBe('Successor preview');
    const current = fixture(); current.service.loadProjectAssetPreview.mockRejectedValue(new Error('Optional thumbnail missing'));
    await current.lease.requestPreview(asset.id); expect(current.state.error).toBeUndefined();
  });
  it('associates a cached base reference only within its captured project, without prompt or library changes', () => {
    const f = fixture();
    expect(f.lease.addReference({ ...asset, projectId: 'other' })).toBe(false);
    expect(f.lease.addReference(asset)).toBe(true);
    expect(f.state.values).toEqual({ prompt: 'Preserve prompt', references: [asset] });
    expect(f.lease.removeReference(asset.id)).toBe(true);
    expect(f.state.values).toEqual({ prompt: 'Preserve prompt', references: [] });
    expect(f.state.assets).toEqual([]); expect(f.service.importProjectAsset).not.toHaveBeenCalled();
  });
  it.each(['add', 'remove'] as const)('drops deferred %s association after workflow retirement', kind => {
    const f = fixture('project-a', true);
    if (kind === 'add') expect(f.lease.addReference(asset)).toBe(true);
    else expect(f.lease.removeReference(asset.id)).toBe(true);
    f.retire(); const successor = { prompt: 'New workflow', references: [asset], newReferences: [] };
    f.state.values = successor; f.flush();
    expect(f.state.values).toBe(successor);
    expect(f.lease.addReference(asset)).toBe(false); expect(f.lease.removeReference(asset.id)).toBe(false);
  });
});
