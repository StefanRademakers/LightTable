import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenAiAssetId, GenAiAssetReference, GenAiModelId, GenAiProviderId, GenAiWorkflowDefinition } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../platform/LightTableHost';
import { useGenAiAssetReferenceImport } from './useGenAiAssetReferenceImport';

interface Effect { setup(): void | (() => void); deps: unknown[]; cleanup?: () => void; changed: boolean }
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as Effect[] }));
vi.mock('react', () => {
  const memo = (create: () => unknown, deps: unknown[]) => {
    const index = hooks.cursor++, old = hooks.slots[index] as { value: unknown; deps: unknown[] } | undefined;
    if (!old || deps.some((value, i) => value !== old.deps[i])) hooks.slots[index] = { value: create(), deps };
    return (hooks.slots[index] as { value: unknown }).value;
  };
  return { default: {
    useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
    useMemo: memo, useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
    useLayoutEffect: (setup: Effect['setup'], deps: unknown[]) => {
      const index = hooks.cursor++, old = hooks.slots[index] as Effect | undefined;
      if (!old) { const effect = { setup, deps, changed: true }; hooks.slots[index] = effect; hooks.effects.push(effect); }
      else { old.changed = deps.some((value, i) => value !== old.deps[i]); old.setup = setup; old.deps = deps; }
    }
  } };
});
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.effects = []; });
afterEach(() => { for (const effect of hooks.effects) effect.cleanup?.(); });
const flush = () => { for (const effect of hooks.effects) if (effect.changed) {
  effect.cleanup?.(); effect.cleanup = effect.setup() || undefined; effect.changed = false;
} };
const deferred = <T>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const workflow: GenAiWorkflowDefinition = { id: 'workflow' as GenAiWorkflowDefinition['id'],
  modelId: 'model' as GenAiModelId, providerId: 'provider' as GenAiProviderId, mode: 'image2image', label: 'Edit',
  fields: [{ key: 'references', kind: 'asset', role: 'references', label: 'References',
    required: false, advanced: false, sourceSchema: {} }] };
const fixture = () => {
  const imported = { id: 'asset' as GenAiAssetId, projectId: 'a', label: 'Image', mediaType: 'image/png' };
  const service = { importProjectAsset: vi.fn(async (): Promise<GenAiAssetReference> => imported),
    loadProjectAssetPreview: vi.fn(async () => 'preview') };
  const context = { service: service as unknown as LightTableGenAiService, projectId: 'a', generation: 1, workflow,
    modelId: workflow.modelId, mode: workflow.mode, providerId: workflow.providerId, providerStatus: 'connected' };
  const state = { assets: [] as readonly GenAiAssetReference[], values: { prompt: 'One' } as Readonly<Record<string, unknown>> };
  const ports = {
    updateAssets: vi.fn((change: (assets: readonly GenAiAssetReference[]) => readonly GenAiAssetReference[]) => { state.assets = change(state.assets); }),
    updateValues: vi.fn((change: (values: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>) => { state.values = change(state.values); }),
    updatePreviews: vi.fn(), updateError: vi.fn()
  };
  const file = { name: 'image.png', size: 8, type: 'image/png', arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) } as unknown as File;
  const render = () => { hooks.cursor = 0; return useGenAiAssetReferenceImport({ ...context }, { ...ports }); };
  return { imported, service, context, state, ports, file, render };
};

describe('Setup reference import capture lifetime', () => {
  it.each(['service', 'project', 'generation', 'workflow', 'model', 'mode', 'provider', 'status'] as const)(
    'old capture cannot adopt the successor %s context even before cleanup', async kind => {
      const f = fixture(); const first = f.render(); flush(); const old = first.captureAssetReferenceImport(() => true);
      if (kind === 'service') f.context.service = {} as LightTableGenAiService;
      else if (kind === 'project') f.context.projectId = 'b';
      else if (kind === 'generation') f.context.generation++;
      else if (kind === 'workflow') f.context.workflow = { ...workflow };
      else if (kind === 'model') f.context.modelId = 'other' as GenAiModelId;
      else if (kind === 'mode') f.context.mode = 'text2image';
      else if (kind === 'provider') f.context.providerId = 'other' as GenAiProviderId;
      else f.context.providerStatus = 'disconnected';
      f.render();
      expect(old.isCurrent()).toBe(false);
      expect(await first.captureAssetReferenceImport(() => true).importFile(f.file)).toBeUndefined();
      expect(f.file.arrayBuffer).not.toHaveBeenCalled(); expect(f.service.importProjectAsset).not.toHaveBeenCalled();
    });
  it('does not reopen a retained capture after A -> B -> A', async () => {
    const f = fixture(); const first = f.render(); flush();
    f.context.projectId = 'b'; f.render(); flush(); f.context.projectId = 'a'; const fresh = f.render(); flush();
    expect(first.captureAssetReferenceImport(() => true).isCurrent()).toBe(false);
    expect(await fresh.importAssetReference(f.file)).toEqual(f.imported);
    expect(f.state.assets).toEqual([f.imported]);
  });
  it('retains imports across ordinary prompt/value rerenders with fresh callback containers', async () => {
    const f = fixture(); const first = f.render(); flush(); const pending = deferred<GenAiAssetReference>();
    f.service.importProjectAsset.mockReturnValue(pending.promise);
    const importing = first.importAssetReference(f.file); await tick();
    f.state.values = { prompt: 'Edited prompt' }; const next = f.render(); flush();
    expect(next.captureAssetReferenceImport).toBe(first.captureAssetReferenceImport);
    pending.resolve(f.imported); expect(await importing).toEqual(f.imported);
    expect(f.state.values).toEqual({ prompt: 'Edited prompt', references: [f.imported] });
  });
  it('rejects a file read that crosses projects before any host import', async () => {
    const f = fixture(); const first = f.render(); flush(); const read = deferred<ArrayBuffer>();
    vi.mocked(f.file.arrayBuffer).mockReturnValue(read.promise);
    const importing = first.importAssetReference(f.file); f.context.projectId = 'b'; f.render(); flush();
    read.resolve(new ArrayBuffer(8)); expect(await importing).toBeUndefined(); expect(f.service.importProjectAsset).not.toHaveBeenCalled();
  });
  it('keeps durable imported assets out of replacement workflow values', async () => {
    const f = fixture(); const first = f.render(); flush(); const imported = deferred<GenAiAssetReference>();
    f.service.importProjectAsset.mockReturnValue(imported.promise);
    const importing = first.importAssetReference(f.file); await tick();
    f.context.workflow = { ...workflow, fields: [{ ...workflow.fields[0], key: 'newReferences' }] };
    f.render(); flush(); imported.resolve(f.imported);
    expect(await importing).toBeUndefined(); expect(f.state.assets).toEqual([]); expect(f.state.values).toEqual({ prompt: 'One' });
    expect(f.service.importProjectAsset).toHaveBeenCalledOnce();
  });
  it('guards external document requests and mount replay without reopening old leases', async () => {
    const f = fixture(); const first = f.render(); flush(); let current = true;
    const old = first.captureAssetReferenceImport(() => current); current = false;
    expect(await old.importFile(f.file)).toBeUndefined();
    const mounted = first.captureAssetReferenceImport(() => true); const effect = hooks.effects[0];
    effect.cleanup?.(); effect.cleanup = effect.setup() || undefined;
    expect(mounted.isCurrent()).toBe(false); expect(first.captureAssetReferenceImport(() => true).isCurrent()).toBe(true);
    effect.cleanup?.(); effect.cleanup = undefined;
    expect(first.captureAssetReferenceImport(() => true).isCurrent()).toBe(false);
  });
});
