import { expect, it, vi } from 'vitest';
import type { GenAiAssetReference, GenAiWorkflowDefinition } from '@lighttable/genai-core';
import { createGenAiAssetReferenceImport } from '../../../genai/application/GenAiAssetReferenceImport';
import { GenAiReferenceHandoff, type GenAiReferenceContext, type GenAiReferenceHandoffPorts } from './GenAiReferenceHandoff';

const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const file = () => new File(['pixels'], 'Opening.png', { type: 'image/png' });
const asset = (projectId = 'P'): GenAiAssetReference => ({ id: 'asset-1' as GenAiAssetReference['id'],
  projectId, label: 'Opening', mediaType: 'image/png', previewId: 'preview' });
const fixture = () => {
  let context: GenAiReferenceContext = { projectId: 'P', documentId: 'A', active: false,
    selectedMode: 'image2image', imageEditReady: true, workflow: {} };
  let revision = 1, runtime = {}, ready = true;
  const documents = new Set(['A', 'B', 'C']);
  const exports = vi.fn(async () => file()); const imports = vi.fn(async (_file: File) => asset(context.projectId));
  const previews = vi.fn(async (_id: GenAiAssetReference['id']) => {}), additions = vi.fn(), removals = vi.fn();
  const publications: GenAiAssetReference[] = [];
  const ports: GenAiReferenceHandoffPorts = {
    readContext: () => context, activateDocument: vi.fn(), reportError: vi.fn(),
    documentState: id => !documents.has(id) ? 'missing' : id === context.documentId && ready ? 'ready' : 'pending',
    captureSource: id => {
      if (!ready || id !== context.documentId) return undefined;
      const openingRevision = revision, openingRuntime = runtime;
      return { isCurrent: () => context.documentId === id && ready && revision === openingRevision && runtime === openingRuntime,
        exportPng: exports };
    },
    captureImport: requestCurrent => {
      const opening = context;
      const isCurrent = () => context.projectId === opening.projectId && context.workflow === opening.workflow
        && context.selectedMode === opening.selectedMode && requestCurrent();
      return { isCurrent,
        importFile: async supplied => {
          if (!isCurrent()) return undefined;
          const result = await imports(supplied);
          if (!isCurrent()) return undefined;
          publications.push(result); return result;
        },
        requestPreview: async id => { if (isCurrent()) await previews(id); },
        addReference: value => { if (!isCurrent()) return false; additions(value); return true; },
        removeReference: id => { if (!isCurrent()) return false; removals(id); return true; }
      };
    }
  };
  const owner = new GenAiReferenceHandoff(ports); let disconnect = owner.connect(); owner.synchronize();
  return { owner, ports, exports, imports, previews, additions, removals, publications, documents,
    set: (patch: Partial<GenAiReferenceContext>) => { context = { ...context, ...patch }; },
    edit: () => { revision++; }, replaceRuntime: () => { runtime = {}; },
    ready: (value: boolean) => { ready = value; },
    replay: () => { disconnect(); disconnect = owner.connect(); owner.synchronize(); },
    disconnect: () => disconnect() };
};

it('captures source and Setup before export; a project change cannot import into its successor', async () => {
  const f = fixture(), pending = deferred<File>(); f.exports.mockReturnValueOnce(pending.promise);
  const result = f.owner.importDocument('A'); f.set({ projectId: 'Q' }); pending.resolve(file());
  expect(await result).toBeUndefined(); expect(f.imports).not.toHaveBeenCalled(); expect(f.ports.reportError).not.toHaveBeenCalled();
});
it.each(['edit', 'replaceRuntime'] as const)('rejects stale %s before import publication', async kind => {
  const f = fixture(), pending = deferred<GenAiAssetReference>(); f.imports.mockReturnValueOnce(pending.promise);
  const result = f.owner.importDocument('A'); await vi.waitFor(() => expect(f.imports).toHaveBeenCalledOnce());
  f[kind](); pending.resolve(asset()); expect(await result).toBeUndefined(); expect(f.publications).toEqual([]);
});
it('allows concurrent manual local imports, without one latest-wins request counter', async () => {
  const f = fixture(), first = deferred<GenAiAssetReference>(); f.imports.mockReturnValueOnce(first.promise);
  const one = f.owner.importFile(file()), two = f.owner.importFile(file());
  expect(await two).toEqual(asset()); first.resolve(asset()); expect(await one).toEqual(asset());
  expect(f.publications).toHaveLength(2); expect(f.previews).toHaveBeenCalledTimes(2);
});
it('retired workflow cannot attach a manual file or request a late preview', async () => {
  const f = fixture(), pending = deferred<GenAiAssetReference>(); f.imports.mockReturnValueOnce(pending.promise);
  const operation = f.owner.importFile(file()); f.set({ workflow: {} }); pending.resolve(asset());
  expect(await operation).toBeUndefined(); expect(f.publications).toEqual([]); expect(f.previews).not.toHaveBeenCalled();
});
it('waits for requested tab ready binding and never exports its origin', async () => {
  const f = fixture(); f.owner.requestTabReference('B'); expect(f.ports.activateDocument).toHaveBeenCalledWith('B');
  f.owner.synchronize(); expect(f.exports).not.toHaveBeenCalled();
  f.set({ documentId: 'B' }); f.ready(false); f.owner.synchronize(); expect(f.exports).not.toHaveBeenCalled();
  f.ready(true); f.owner.synchronize(); f.owner.synchronize();
  await vi.waitFor(() => expect(f.publications).toHaveLength(1)); expect(f.exports).toHaveBeenCalledOnce();
  expect(f.owner.getSnapshot().pendingTabReference).toBe(false);
});
it.each(['project', 'third-tab', 'closed-target'] as const)('retires pending tab reference on %s', async kind => {
  const f = fixture(); f.owner.requestTabReference('B');
  if (kind === 'project') f.set({ projectId: 'Q', documentId: 'B' });
  else if (kind === 'third-tab') f.set({ documentId: 'C' });
  else f.documents.delete('B');
  f.owner.synchronize(); f.set({ documentId: 'B' }); f.owner.synchronize();
  expect(f.exports).not.toHaveBeenCalled(); expect(f.owner.getSnapshot().pendingTabReference).toBe(false);
});
it('pins tab source through its later import, not merely through PNG export', async () => {
  const f = fixture(), pending = deferred<GenAiAssetReference>(); f.imports.mockReturnValueOnce(pending.promise);
  f.owner.requestTabReference('A'); await vi.waitFor(() => expect(f.imports).toHaveBeenCalledOnce());
  f.edit(); pending.resolve(asset()); await vi.waitFor(() => expect(f.owner.getSnapshot().pendingTabReference).toBe(false));
  expect(f.publications).toEqual([]);
});
it('starts a new base scope even while old export hangs; old completion cannot replace it', async () => {
  const f = fixture(), pending = deferred<File>(); f.exports.mockReturnValueOnce(pending.promise);
  f.set({ active: true }); f.owner.synchronize(); expect(f.exports).toHaveBeenCalledOnce();
  f.set({ documentId: 'B' }); f.owner.synchronize();
  await vi.waitFor(() => expect(f.owner.getSnapshot().baseImageAssetId).toBe(asset().id));
  expect(f.exports).toHaveBeenCalledTimes(2); pending.resolve(file()); await Promise.resolve();
  expect(f.imports).toHaveBeenCalledOnce();
});
it('unchecking cancels pending base import before attachment and keeps durable import cleanup outside owner', async () => {
  const f = fixture(), pending = deferred<GenAiAssetReference>(); f.imports.mockReturnValueOnce(pending.promise);
  f.set({ active: true }); f.owner.synchronize(); await vi.waitFor(() => expect(f.imports).toHaveBeenCalledOnce());
  f.owner.setBaseImageSelected(false); pending.resolve(asset()); await Promise.resolve();
  expect(f.owner.getSnapshot().baseImageAssetId).toBeUndefined(); expect(f.publications).toEqual([]);
});
it('retains captured base snapshot across ordinary workflow changes and pixel revisions', async () => {
  const f = fixture(); f.set({ active: true }); f.owner.synchronize();
  await vi.waitFor(() => expect(f.owner.getSnapshot().baseImageAssetId).toBe(asset().id));
  f.edit(); f.owner.synchronize(); expect(f.exports).toHaveBeenCalledOnce();
  f.set({ workflow: {}, selectedMode: 'text2image', imageEditReady: false }); f.owner.synchronize();
  expect(f.owner.getSnapshot().baseImageSelected).toBe(false); expect(f.owner.getSnapshot().baseImageAssetId).toBe(asset().id);
  f.set({ workflow: {}, selectedMode: 'image2image', imageEditReady: true }); f.owner.synchronize();
  expect(f.exports).toHaveBeenCalledOnce(); expect(f.additions).toHaveBeenCalledTimes(2);
  f.owner.setBaseImageSelected(false); expect(f.removals).toHaveBeenCalledWith(asset().id);
  expect(f.owner.getSnapshot().baseImageAssetId).toBeUndefined();
});
it('reports current export failure once and does not automatically retry until explicit checkbox intent', async () => {
  const f = fixture(); f.exports.mockRejectedValueOnce(new Error('PNG export failed')); f.set({ active: true }); f.owner.synchronize();
  await vi.waitFor(() => expect(f.ports.reportError).toHaveBeenCalledWith('PNG export failed'));
  f.owner.synchronize(); f.edit(); f.owner.synchronize(); expect(f.exports).toHaveBeenCalledOnce();
  f.owner.setBaseImageSelected(false); f.owner.setBaseImageSelected(true);
  await vi.waitFor(() => expect(f.owner.getSnapshot().baseImageAssetId).toBe(asset().id)); expect(f.exports).toHaveBeenCalledTimes(2);
});
it('StrictMode reconnect permits a fresh attempt without reviving old completion/error', async () => {
  const f = fixture(), pending = deferred<File>(); f.exports.mockReturnValueOnce(pending.promise);
  f.set({ active: true }); f.owner.synchronize(); f.replay(); pending.reject(new Error('Retired export failed'));
  await vi.waitFor(() => expect(f.owner.getSnapshot().baseImageAssetId).toBe(asset().id));
  expect(f.ports.reportError).not.toHaveBeenCalled(); expect(f.imports).toHaveBeenCalledOnce();
});

const delayedAssociationFixture = () => {
  const f = fixture(); let generation = 0;
  const workflow = { id: 'edit', mode: 'image2image', fields: [{ key: 'references', kind: 'asset', role: 'references' }] } as unknown as GenAiWorkflowDefinition;
  f.set({ workflow });
  const state = { assets: [] as readonly GenAiAssetReference[], values: {} as Readonly<Record<string, unknown>>,
    previews: {} as Readonly<Record<string, string>> };
  const updates: (() => void)[] = [];
  const importHost = vi.fn(async () => asset());
  f.ports.captureImport = requestCurrent => {
    const opening = generation, context = f.ports.readContext();
    return createGenAiAssetReferenceImport({ service: { importProjectAsset: importHost,
      loadProjectAssetPreview: async () => 'preview' }, projectId: context.projectId,
      workflow: context.workflow as GenAiWorkflowDefinition,
      isCurrent: () => opening === generation && requestCurrent() }, {
      updateAssets: change => { updates.push(() => { state.assets = change(state.assets); }); },
      updateValues: change => { updates.push(() => { state.values = change(state.values); }); },
      updatePreviews: change => { updates.push(() => { state.previews = change(state.previews); }); },
      updateError: () => {}, readLocalPreview: async () => 'local-preview'
    });
  };
  return { ...f, state, workflow, importHost,
    changeWorkflow: (next: GenAiWorkflowDefinition) => { generation++; f.set({ workflow: next }); },
    flush: () => { for (const update of updates.splice(0)) update(); } };
};
it('successful tab import retains authority for React publications flushed after the whole async operation', async () => {
  const f = delayedAssociationFixture(); f.owner.requestTabReference('A');
  await vi.waitFor(() => expect(f.importHost).toHaveBeenCalledOnce());
  for (let index = 0; index < 20; index++) await Promise.resolve();
  expect(f.state.assets).toEqual([]); f.flush();
  expect(f.state.assets).toEqual([asset()]); expect(f.state.values.references).toEqual([asset()]);
  expect(f.state.previews[asset().id]).toBe('preview');
});
it('re-admits a cached base attachment after workflow A→B→same A retires its deferred updater', async () => {
  const f = delayedAssociationFixture(); f.set({ active: true }); f.owner.synchronize();
  await vi.waitFor(() => expect(f.owner.getSnapshot().baseImageAssetId).toBe(asset().id));
  f.changeWorkflow({ ...f.workflow, id: 'B' as GenAiWorkflowDefinition['id'] });
  f.set({ imageEditReady: false }); f.owner.synchronize(); f.flush();
  expect(f.state.values.references).toBeUndefined();
  f.changeWorkflow(f.workflow); f.set({ imageEditReady: true }); f.owner.synchronize(); f.flush();
  expect(f.state.values.references).toEqual([asset()]); expect(f.exports).toHaveBeenCalledOnce();
});
it('does not attach cached base from a deferred updater after the checkbox is cleared', async () => {
  const f = delayedAssociationFixture(); f.set({ active: true }); f.owner.synchronize();
  await vi.waitFor(() => expect(f.owner.getSnapshot().baseImageAssetId).toBe(asset().id));
  f.owner.setBaseImageSelected(false); f.flush();
  expect(f.state.assets).toEqual([]); expect(f.state.values.references ?? []).toEqual([]);
});
it('drops foreign-project base association without removing a same-ID reference in the successor project', async () => {
  const f = fixture(); f.set({ active: true }); f.owner.synchronize();
  await vi.waitFor(() => expect(f.owner.getSnapshot().baseImageAssetId).toBe(asset().id));
  f.set({ projectId: 'Q', active: false }); f.owner.synchronize();
  expect(f.removals).not.toHaveBeenCalled(); expect(f.owner.getSnapshot().baseImageAssetId).toBeUndefined();
});
