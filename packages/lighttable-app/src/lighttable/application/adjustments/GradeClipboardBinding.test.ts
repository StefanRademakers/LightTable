import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '../documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createDefaultAdjustments, type BasicAdjustments } from '../../types';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createAdjustmentTransactionController } from './useAdjustmentTransactionController';
import { GradeAssetCommandService } from './GradeAssetCommandService';
import { createGradeClipboardBinding } from './GradeClipboardBinding';
import { LightTableArtifactRegistry } from '../commands/lightTableArtifactRegistry';
import { SemanticGradeClipboardCommandHandler } from '../commands/semanticGradeClipboardCommandHandler';
import type { LightTableCommandPorts, LightTableCommandResult } from '../commands/lightTableCommandContract';
import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import { copyLightTableGrade, readLightTableGrade } from '../../lightTableGradeClipboard';

const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); vi.unstubAllGlobals(); });
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value) }, dispatchEvent: vi.fn() });
});
const fixture = () => {
  const session = new DocumentSession({ id: 'document' as never,
    source: { id: 'source', name: 'Grade source', mediaType: 'image/png' } });
  sessions.push(session); session.setDocument(createImageDocument('Grade source', 20, 20, 'source')); session.setReady();
  let mounted = session, generation = 1, target = 'global', contextual: BasicAdjustments | null = null;
  const makeRenderer = () => ({ getColorLookupAssetSource: vi.fn(() => null), loadColorLookupAsset: vi.fn(async () => {}),
    removeColorLookupAsset: vi.fn(() => true), setScopeInteractionActive: vi.fn(), setLensBlurInteractionActive: vi.fn() });
  let renderer = makeRenderer();
  const entries: EditorHistoryEntry[] = [], status = vi.fn(), reportError = vi.fn(), onChange = vi.fn();
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => session.getSnapshot().document, applySnapshot: document => session.setDocument(document),
    previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: entry => entries.push(entry)
  }));
  const adjustments = createAdjustmentTransactionController(() => ({
    getDocumentId: () => session.getSnapshot().document!.id, getDocument: () => session.getSnapshot().document,
    getDocumentAdjustments: () => session.getSnapshot().processing.adjustments,
    getCanonicalAdjustments: () => contextual ?? session.getSnapshot().processing.adjustments,
    getActiveTargetLayerId: () => null, getActiveTargetIdentity: () => target,
    getRenderer: () => renderer, getRendererGeneration: () => generation, isMutationBlocked: () => false,
    documentMutations: mutations, previewDocumentProcessing: vi.fn(),
    commitDocumentProcessing: value => session.publishProcessing({ adjustments: value }),
    stageEditorAdjustments: vi.fn(), restoreStagedSnapshot: vi.fn(), discardPreview: vi.fn(),
    pushProcessingHistoryEntry: entry => entries.push(entry)
  }));
  const captureScope = () => {
    const opening = renderer, epoch = generation;
    const isCurrent = () => renderer === opening && generation === epoch;
    return { isCurrent, assertCurrent: () => { if (!isCurrent()) throw new Error('Retired'); } };
  };
  const assets = new GradeAssetCommandService({
    mutations, captureScope, getSession: () => mounted, getDocument: () => session.getSnapshot().document,
    getRenderer: () => renderer, finishAdjustment: vi.fn(), settleInteraction: vi.fn(async () => {}),
    getDocumentAdjustments: () => session.getSnapshot().processing.adjustments,
    resolveTarget: () => ({ identity: target, layerId: null, adjustments: contextual ?? session.getSnapshot().processing.adjustments }),
    applyCanonicalProjection: vi.fn(), pushHistoryEntry: entry => entries.push(entry),
    changeGrade: recipe => { const changed = adjustments.change(recipe, 'grade'); onChange(); return changed; }
  });
  const registry = new LightTableArtifactRegistry(), handler = new SemanticGradeClipboardCommandHandler(registry);
  let binding: ReturnType<typeof createGradeClipboardBinding>;
  const dispatch = (command: 'grade.copy' | 'grade.paste', parameters: unknown = {}) => handler.dispatch(command, parameters, session.id, {
    copyGrade: () => binding.prepareCopy(), pasteGrade: (_id: unknown, capture: Parameters<typeof binding.paste>[0]) => binding.paste(capture)
  } as unknown as LightTableCommandPorts);
  const execute = vi.fn(async (command: 'grade.copy' | 'grade.paste', parameters: unknown): Promise<LightTableCommandResult> => {
    const result = await dispatch(command, parameters);
    return result.ok ? { requestId: 'ui', status: 'completed', revisions: { workspace: 0 }, value: result.value }
      : { requestId: 'ui', status: 'rejected', revisions: { workspace: 0 }, code: result.code, message: result.message };
  });
  const bind = (owner = handler) => createGradeClipboardBinding({
    session, renderer, getSession: () => mounted, getRenderer: () => renderer,
    getProjectedDocument: () => session.getSnapshot().document, captureScope,
    getContextualSettings: () => contextual, getTargetIdentity: () => target, assets,
    commands: { resolveGradeClipboardArtifact: owner.resolveArtifact.bind(owner), releaseArtifact: id => registry.release(id) }, execute,
    setStatus: status, reportError
  });
  binding = bind();
  const setExposure = (exposureEV: number) => session.publishProcessing({
    adjustments: { ...session.getSnapshot().processing.adjustments, exposureEV }
  });
  return { session, binding, bind, handler, registry, dispatch, execute, status, reportError, entries, assets, onChange,
    setExposure, setContext: (value: BasicAdjustments | null) => { contextual = value; target = value ? 'local' : 'global'; },
    retire: () => { renderer = makeRenderer(); generation++; },
    replaceSession: () => { mounted = new DocumentSession({ id: session.id, source: session.getSnapshot().source }); sessions.push(mounted); }
  };
};

describe('GradeClipboardBinding', () => {
  it('UI Paste follows semantic Copy B after UI Copy A, reusing B artifact and preserving Lens FX/no-op history', async () => {
    const f = fixture(); f.setExposure(0.5); await f.binding.copyCurrentGrade();
    f.setExposure(-1); expect((await f.dispatch('grade.copy')).ok).toBe(true);
    const copied = readLightTableGrade()!, artifactId = copied.artifactAssociation!.artifactId;
    const destination = createDefaultAdjustments(); destination.exposureEV = 3; destination.effects.grain.enabled = true;
    f.session.publishProcessing({ adjustments: destination });
    await f.binding.pasteCurrentGrade();
    expect(f.execute).toHaveBeenLastCalledWith('grade.paste', { artifactId }, null);
    expect(f.session.getSnapshot().processing.adjustments.exposureEV).toBe(-1);
    expect(f.session.getSnapshot().processing.adjustments.effects.grain.enabled).toBe(true);
    expect(f.entries).toHaveLength(1); expect(f.registry.list()).toHaveLength(2);
    await f.binding.pasteCurrentGrade(); expect(f.entries).toHaveLength(1);
    expect(readLightTableGrade()?.captureIdentity).toBe(copied.captureIdentity);
    expect(f.reportError).not.toHaveBeenCalled();
  });

  it('captures contextual settings before global and rejects missing LUT before clipboard/status publication', async () => {
    const f = fixture(); f.setExposure(3); await f.binding.copyCurrentGrade();
    const previous = readLightTableGrade()!; f.status.mockClear();
    const local = createDefaultAdjustments(); local.exposureEV = -2; local.gradeLook.assetId = 'missing';
    f.setContext(local); expect(f.binding.prepareCopy().capture.settings.exposureEV).toBe(-2);
    await f.binding.copyCurrentGrade();
    expect(f.reportError).toHaveBeenCalledOnce(); expect(f.reportError.mock.calls[0][0]).toMatch(/could not be captured/);
    expect(f.status).not.toHaveBeenCalled(); expect(readLightTableGrade()?.captureIdentity).toBe(previous.captureIdentity);
    expect(f.registry.list()).toHaveLength(1);
  });

  it.each(['processing', 'target', 'runtime', 'session'] as const)('rejects %s retirement after pure Copy capture', async kind => {
    const f = fixture(); const pending = f.dispatch('grade.copy');
    if (kind === 'processing') f.setExposure(2);
    if (kind === 'target') f.setContext(createDefaultAdjustments());
    if (kind === 'runtime') f.retire();
    if (kind === 'session') f.replaceSession();
    expect(await pending).toMatchObject({ ok: false });
    expect(readLightTableGrade()).toBeNull(); expect(f.status).not.toHaveBeenCalled(); expect(f.registry.list()).toHaveLength(0);
  });

  it('registers a persisted/current capture on eviction or service replacement without another Copy', async () => {
    const f = fixture(); const copied = copyLightTableGrade(createDefaultAdjustments(), 'Persisted');
    await f.binding.pasteCurrentGrade(); const first = readLightTableGrade()!.artifactAssociation!;
    f.registry.release(first.artifactId); await f.binding.pasteCurrentGrade();
    expect(readLightTableGrade()!.artifactAssociation!.artifactId).not.toBe(first.artifactId);
    const other = new SemanticGradeClipboardCommandHandler(new LightTableArtifactRegistry());
    await f.bind(other).pasteCurrentGrade();
    expect(readLightTableGrade()!.artifactAssociation!.owner).toBe(other);
    expect(readLightTableGrade()?.captureIdentity).toBe(copied.captureIdentity);
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch Paste when a newer Copy replaces the shared capture during registration', async () => {
    const f = fixture(); copyLightTableGrade(createDefaultAdjustments(), 'Opening');
    const register = f.handler.resolveArtifact.bind(f.handler);
    vi.spyOn(f.handler, 'resolveArtifact').mockImplementation((capture, association) => {
      const result = register(capture, association);
      copyLightTableGrade({ ...createDefaultAdjustments(), exposureEV: 2 }, 'Newer');
      return result;
    });
    await f.bind().pasteCurrentGrade();
    expect(f.execute).not.toHaveBeenCalled(); expect(f.entries).toHaveLength(0);
    expect(f.registry.list()).toHaveLength(0);
    expect(readLightTableGrade()?.name).toBe('Newer');
    expect(f.reportError).toHaveBeenCalledWith('The Grade clipboard changed before it could be pasted.');
  });

  it('retains committed Paste truth but suppresses late status after synchronous publication retirement', async () => {
    const f = fixture(); const capture = { name: 'Copied', settings: { ...createDefaultAdjustments(), exposureEV: 1 } };
    f.onChange.mockImplementation(f.retire);
    expect(await f.binding.paste(capture)).toMatchObject({ changed: true });
    expect(f.session.getSnapshot().processing.adjustments.exposureEV).toBe(1);
    expect(f.entries).toHaveLength(1); expect(f.status).not.toHaveBeenCalled();
  });

  it.each([false, true])('reports current UI rejection once and suppresses retired rejection (%s)', async retired => {
    const f = fixture(); let reject!: (reason: Error) => void;
    f.execute.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = f.binding.copyCurrentGrade(); if (retired) f.retire(); reject(new Error('Copy failed')); await pending;
    expect(f.reportError).toHaveBeenCalledTimes(retired ? 0 : 1);
    if (!retired) expect(f.reportError).toHaveBeenCalledWith('Copy failed');
  });
});
