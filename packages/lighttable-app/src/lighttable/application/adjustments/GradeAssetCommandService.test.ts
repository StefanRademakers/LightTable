import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type DocumentAssetId, type ImageDocument } from '../../editor/document/documentTypes';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { captureInteractionScope } from '../interactions/captureInteractionScope';
import type { ColorLookupCanonicalProjection } from './commitColorLookupAssetTransaction';
import { GradeAssetCommandService } from './GradeAssetCommandService';
import { createAdjustmentTransactionController } from './useAdjustmentTransactionController';

const cube = 'TITLE "Tiny LUT"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
const file = () => new File([cube], 'look.cube');
const setup = () => {
  const initial = createImageDocument('Fixture', 16, 9, 'source');
  const state = { document: initial as ImageDocument, session: {}, rendererGeneration: 1,
    target: 'global-grade', adjustments: createDefaultAdjustments(), failHistory: false };
  const makeRenderer = () => ({ loadColorLookupAsset: vi.fn(async () => {}), removeColorLookupAsset: vi.fn(() => true),
    setScopeInteractionActive: vi.fn(), setLensBlurInteractionActive: vi.fn() });
  const runtime = makeRenderer();
  let renderer = runtime;
  const entries: EditorHistoryEntry[] = [];
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => state.document, applySnapshot: next => { state.document = next; },
    previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: vi.fn()
  }));
  const apply = vi.fn((projection: ColorLookupCanonicalProjection) => {
    if (projection.document) state.document = projection.document;
    state.adjustments = projection.documentAdjustments;
  });
  const pushHistoryEntry = (entry: EditorHistoryEntry) => {
    if (state.failHistory) throw new Error('History rejected');
    entries.push(entry);
  };
  const adjustments = createAdjustmentTransactionController(() => ({
    getDocumentId: () => state.document.id, getDocument: () => state.document,
    getDocumentAdjustments: () => state.adjustments, getCanonicalAdjustments: () => state.adjustments,
    getActiveTargetLayerId: () => null, getActiveTargetIdentity: () => state.target,
    getRenderer: () => renderer, getRendererGeneration: () => state.rendererGeneration,
    documentMutations: mutations, previewDocumentProcessing: vi.fn(),
    commitDocumentProcessing: next => { state.adjustments = next; },
    stageEditorAdjustments: vi.fn(), restoreStagedSnapshot: vi.fn(), discardPreview: vi.fn(),
    pushProcessingHistoryEntry: pushHistoryEntry
  }));
  const lifecycle = {};
  const ports = {
    mutations,
    captureScope: () => captureInteractionScope({ getWorkspaceId: () => state.document.id,
      getLifecycleIdentity: () => lifecycle, getRenderer: () => renderer,
      getRendererGeneration: () => state.rendererGeneration }),
    getSession: () => state.session,
    getDocument: () => state.document,
    getRenderer: () => renderer,
    finishAdjustment: vi.fn(), settleInteraction: vi.fn(async () => {}),
    getDocumentAdjustments: () => state.adjustments,
    resolveTarget: () => ({ identity: state.target, layerId: null, adjustments: state.adjustments }),
    applyCanonicalProjection: apply,
    pushHistoryEntry,
    changeGrade: vi.fn((recipe: (current: BasicAdjustments) => BasicAdjustments) => adjustments.change(recipe, 'grade'))
  };
  return { initial, state, runtime, entries, ports, apply, service: new GradeAssetCommandService(ports),
    rebind: () => { renderer = makeRenderer(); }
  };
};
const deferred = () => {
  let resolve!: (value: string) => void;
  return { promise: new Promise<string>(done => { resolve = done; }), resolve: (value: string) => resolve(value) };
};

describe('GradeAssetCommandService', () => {
  it.each(['grade-look', 'photoshop-color-lookup'] as const)('imports %s metadata through one owned asset transaction', async purpose => {
    const f = setup();
    expect(await f.service.load(file(), purpose)).toEqual({ name: 'Tiny LUT', size: 2 });
    const asset = f.state.document.assets.colorLookups[0];
    expect(asset).toMatchObject({ name: 'Tiny LUT', size: 2, byteLength: file().size });
    expect(purpose === 'grade-look' ? f.state.adjustments.gradeLook.assetId
      : f.state.adjustments.photoshopAdjustment.colorLookupAssetId).toBe(asset.id);
    expect(f.entries).toHaveLength(1);
    expect(f.entries[0].resourceIds).toEqual([asset.id]);
    expect(f.runtime.loadColorLookupAsset).toHaveBeenCalledOnce();
    await f.entries[0].undo(); expect(f.state.document).toBe(f.initial);
    await f.entries[0].redo(); expect(f.state.document.assets.colorLookups[0]).toBe(asset);
  });

  it('validates files before settling or acquiring any document operation', async () => {
    const f = setup();
    await expect(f.service.load(new File(['x'], 'bad.txt'), 'grade-look')).rejects.toThrow('3D .cube');
    await expect(f.service.load(new File([], 'empty.cube'), 'grade-look')).rejects.toThrow('32 MiB');
    expect(f.ports.finishAdjustment).not.toHaveBeenCalled();
    expect(f.runtime.loadColorLookupAsset).not.toHaveBeenCalled();
  });

  it('captures the committed document after adjustment and transform settlement', async () => {
    const f = setup();
    const settled = { ...f.initial, name: 'After transform', revision: 1 };
    f.ports.finishAdjustment.mockImplementation(() => { f.state.adjustments = { ...f.state.adjustments, exposureEV: 2 }; });
    f.ports.settleInteraction.mockImplementation(async () => { f.state.document = settled; });
    await f.service.load(file(), 'grade-look');
    expect(f.state.document.name).toBe(settled.name);
    expect(f.state.adjustments.exposureEV).toBe(2);
    await f.entries[0].undo(); expect(f.state.document).toBe(settled);
  });

  it.each(['session', 'renderer', 'generation', 'target'] as const)('rejects %s changes during settlement before import', async kind => {
    const f = setup();
    f.ports.settleInteraction.mockImplementation(async () => {
      if (kind === 'session') f.state.session = {};
      if (kind === 'renderer') f.rebind();
      if (kind === 'generation') f.state.rendererGeneration++;
      if (kind === 'target') f.state.target = 'another-owner';
    });
    await expect(f.service.load(file(), 'grade-look')).rejects.toThrow(/retired|target changed/);
    expect(f.runtime.loadColorLookupAsset).not.toHaveBeenCalled();
  });

  it.each(['session', 'renderer', 'document', 'target', 'processing'] as const)('rejects %s changes during parse, without any upload', async kind => {
    const f = setup(); const pending = deferred(); const source = file();
    const read = vi.spyOn(source, 'text').mockReturnValue(pending.promise);
    const loading = f.service.load(source, 'grade-look');
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    if (kind === 'session') f.state.session = {};
    if (kind === 'renderer') f.rebind();
    if (kind === 'document') f.state.document = { ...f.initial, revision: 1 };
    if (kind === 'target') f.state.target = 'another-owner';
    if (kind === 'processing') f.state.adjustments = { ...f.state.adjustments, exposureEV: 1 };
    pending.resolve(cube);
    await expect(loading).rejects.toThrow('target changed');
    expect(f.runtime.loadColorLookupAsset).not.toHaveBeenCalled();
    expect(f.entries).toHaveLength(0);
  });

  it.each(['upload', 'history', 'retirement'] as const)('does not leave metadata/history after %s failure', async kind => {
    const f = setup();
    if (kind === 'upload') f.runtime.loadColorLookupAsset.mockRejectedValue(new Error('Upload rejected'));
    if (kind === 'history') f.state.failHistory = true;
    if (kind === 'retirement') f.runtime.loadColorLookupAsset.mockImplementation(async () => { f.rebind(); });
    await expect(f.service.load(file(), 'grade-look')).rejects.toThrow();
    expect(f.state.document).toBe(f.initial);
    expect(f.state.adjustments.gradeLook.assetId).toBeNull();
    expect(f.entries).toHaveLength(0);
    if (kind !== 'upload') expect(f.runtime.removeColorLookupAsset).toHaveBeenCalledOnce();
  });

  it('imports a foreign Grade LUT once and replays after renderer/inspector rebind but never into another session', async () => {
    const f = setup(); const settings = createDefaultAdjustments();
    settings.exposureEV = 1; settings.gradeLook.assetId = 'foreign-lut';
    const result = await f.service.paste({ name: 'Foreign Grade', settings,
      gradeLookAsset: { assetId: 'foreign-lut', name: 'Foreign LUT', source: file() } });
    expect(result).toMatchObject({ changed: true, importedLookAsset: true });
    expect(f.state.adjustments.gradeLook.assetId).not.toBe('foreign-lut');
    expect(f.entries).toHaveLength(1);
    const committed = f.state.document;
    f.rebind(); f.state.target = 'some-other-inspector';
    await f.entries[0].undo(); expect(f.state.document).toBe(f.initial);
    await f.entries[0].redo(); expect(f.state.document).toBe(committed);
    const calls = f.apply.mock.calls.length;
    f.state.session = {};
    expect(() => f.entries[0].undo()).toThrow('another document session');
    expect(f.apply).toHaveBeenCalledTimes(calls);
  });

  it('reuses same-document LUTs without import, preserving the existing no-op decision', async () => {
    const f = setup(); await f.service.load(file(), 'grade-look');
    const settings = f.state.adjustments;
    const result = await f.service.paste({ name: 'Same', settings });
    expect(result).toMatchObject({ changed: false, importedLookAsset: false });
    expect(f.ports.changeGrade.mock.calls[0][0](settings)).toEqual(settings);
    expect(f.runtime.loadColorLookupAsset).toHaveBeenCalledOnce();
    expect(f.entries).toHaveLength(1);
  });

  it('drops only an unresolved foreign reference from a text-only Grade', async () => {
    const f = setup(); const settings = createDefaultAdjustments();
    settings.exposureEV = 2; settings.gradeLook.assetId = 'foreign' as DocumentAssetId;
    await f.service.paste({ name: 'Text only', settings });
    expect(f.ports.changeGrade.mock.calls[0][0](createDefaultAdjustments())).toMatchObject({
      exposureEV: 2, gradeLook: expect.objectContaining({ assetId: null })
    });
    expect(f.runtime.loadColorLookupAsset).not.toHaveBeenCalled();
    expect(settings.gradeLook.assetId).toBe('foreign');
  });

  it('returns only after the existing controller commits a real change, and propagates rejected history', async () => {
    const f = setup(); const settings = { ...createDefaultAdjustments(), exposureEV: 2 };
    expect(await f.service.paste({ name: 'Changed', settings })).toMatchObject({ changed: true });
    expect(f.state.adjustments.exposureEV).toBe(2); expect(f.entries).toHaveLength(1);
    const snapshot = f.state.document;
    expect(await f.service.paste({ name: 'Identical', settings })).toMatchObject({ changed: false });
    expect(f.state.document).toBe(snapshot); expect(f.entries).toHaveLength(1);
    f.state.failHistory = true;
    await expect(f.service.paste({ name: 'Rejected', settings: { ...settings, exposureEV: 3 } })).rejects.toThrow('History rejected');
    expect(f.state.adjustments.exposureEV).toBe(2); expect(f.entries).toHaveLength(1);
  });
});
