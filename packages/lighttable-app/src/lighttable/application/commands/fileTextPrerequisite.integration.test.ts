import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { EditorApplicationSession } from '../workspace/editorApplicationSession';
import { createImageDocument, type DocumentFontAsset } from '../../editor/document/documentTypes';
import { TextCreationInteraction, type TextCreationPorts } from '../text/TextCreationInteraction';
import { DocumentFileIntents } from '../documents/DocumentFileIntents';
import { createDocumentSessionCommandPorts } from './documentSessionCommandPorts';
import { LightTableCommandPortRegistry, LightTableCommandService, LIGHTTABLE_COMMAND_PROTOCOL_VERSION } from './lightTableCommandService';
import type { DocumentLightTableCommandPorts, LightTableCommandExecutionContext, LightTableCommandId } from './lightTableCommandContract';
import type { TrackedTextCreationCommand } from './DocumentCommandExecutionQueue';
import { createMountedTextCommandBinding } from '../../composition/text/createMountedTextCommandBinding';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createDocumentHistoryController } from './useDocumentHistoryController';
import { DocumentSession } from '../documents/documentSession';

const deferred = <T = void>() => { let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const font: DocumentFontAsset = { assetId: 'fixture-font', faceIndex: 0, fingerprintSha256: 'a'.repeat(64),
  source: 'document', container: 'woff2', outline: 'truetype', postScriptName: 'Fixture-Regular',
  embedding: { level: 'installable', noSubsetting: false, bitmapOnly: false }, familyNames: ['Fixture'],
  styleName: 'Regular', weight: 400, stretch: 100, italic: false, byteLength: 10 };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); });

const setup = () => {
  const workspace = new WorkspaceSession(), application = new EditorApplicationSession();
  const opened = workspace.open({ source: { id: 'source', name: 'Text', mediaType: 'image/png' } });
  if (!opened.ok) throw new Error('Open failed');
  const session = opened.value;
  session.setDocument(createImageDocument('Text', 100, 100, 'source')); session.setReady(); session.fonts.registerReference(font);
  // Font availability and artifact encoding are fixtures; semantic text, mutation and history are real owners.
  vi.spyOn(session.fonts, 'availableAssets', 'get').mockReturnValue([font]);
  const initial = session.getSnapshot().document!;
  const canonical = createDocumentSessionCommandPorts(session, application);
  const registry = new LightTableCommandPortRegistry();
  const service = new LightTableCommandService(workspace, registry);
  cleanup.push(() => { service.dispose(); workspace.dispose(); });
  let renderer = { configureTextFonts: vi.fn() }, current = true, sequence = 0;
  let mountedSession = session;
  let duringText: () => void = () => {}, afterText: () => Promise<void> = async () => {};
  let pixels: () => Promise<void> = async () => {}, context: LightTableCommandExecutionContext = { origin: 'ui', recording: 'record' };
  let handle: TrackedTextCreationCommand | null = null;
  const fonts = deferred(), order: string[] = [], failures = vi.fn();
  const request = (command: LightTableCommandId, parameters: unknown = {}) => ({
    protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION, requestId: `request-${++sequence}`, command, documentId: session.id, parameters });
  const settings = { ...application.getSnapshot().text, family: 'Fixture', style: 'Regular' };
  const creationPorts: TextCreationPorts = {
    getDocument: () => session.getSnapshot().document, getTool: () => 'text-point', getSettings: () => settings,
    getColor: () => '#123456', getScale: () => 1, getRenderer: () => renderer, rendererReady: () => true,
    getFontRuntime: () => session.fonts as never, getFontRegistry: () => session.fonts,
    getFonts: () => session.fonts.availableAssets, prepareFont: () => fonts.promise, probe: async () => {},
    captureScope: () => { const opening = renderer; return { isCurrent: () => current && renderer === opening,
      assertCurrent: () => { if (!current || renderer !== opening) throw new Error('Retired'); } }; },
    enqueue: (parameters, assertCurrent) => {
      handle = service.enqueueTextCreation({ ...request('text.create', parameters), command: 'text.create' }, assertCurrent, context);
      return handle;
    }, beginEditing: vi.fn(), setStatus: vi.fn(), reportFailure: failures
  };
  const creation = new TextCreationInteraction(() => creationPorts);
  const history = createDocumentHistoryController(() => ({ documentId: session.id, history: session.history,
    getDocument: () => session.getSnapshot().document, getRenderer: () => null,
    finishOpenTransactions: () => {}, setError: failures }));
  const mutations = createDocumentMutationController(() => ({ getDocument: () => session.getSnapshot().document,
    applySnapshot: document => session.setDocument(document), previewSnapshot: () => {}, discardPreview: () => {},
    pushHistoryEntry: history.record, isMutationBlocked: () => !session.isAcceptingMutations() }));
  const mountedText = createMountedTextCommandBinding(session, renderer, {
    getSession: () => mountedSession, getRenderer: () => renderer, captureScope: creationPorts.captureScope,
    waitForExactRender: async () => true, reportPendingRender: vi.fn(), reportRenderFailure: failures
  }, { fontRegistry: session.fonts, getTextSettings: () => settings,
    getForegroundColor: () => '#123456', changeDocument: mutations.change });
  const files = new DocumentFileIntents(() => ({
    getSession: () => session, getRenderer: () => renderer,
    captureScope: creationPorts.captureScope, commands: service, nextRequestId: () => `file-${++sequence}`,
    settlePixels: () => pixels(), commitAdjustments: async () => {}, finishTextEditing: () => {}, commitLayerDocument: async () => {},
    finishTextCreation: creation.finishForFile, captureTextCreation: creation.captureForFile,
    save: async () => {}, exportJpeg: async () => {}, exportWebp: async () => {}, exportTiff: async () => {},
    exportPsd: async () => {}, exportPsdMaximumAppearance: async () => {}, exportSvg: async () => {},
    deliverExportFile: async () => {}, reportError: failures
  }));
  const exportArtifact = vi.fn(async () => {
    order.push('export'); return new File([JSON.stringify(session.getSnapshot().document)], 'text.png', { type: 'image/png' });
  });
  const ports: DocumentLightTableCommandPorts = { ...canonical, supportsCommand: () => true,
    settleInteractionBeforeCommand: async (command, prerequisite) => {
      order.push(`settle:${command}`);
      if (command === 'file.exportPng') {
        if (!prerequisite) throw new Error('Missing runner prerequisite');
        await files.prepareForCommand(session, prerequisite);
      }
    },
    executeTextCommand: async (command, assertCurrent) => {
      const execution = mountedText(command, assertCurrent);
      duringText();
      const result = await execution;
      order.push('text');
      if (result) expect(service.recordObservedCommand('text.create', session.id,
        { mode: 'point', text: 'Text', origin: { x: 4, y: 5 } }, result)).toBe(false);
      await afterText(); return result;
    },
    renameLayer: (...args) => { order.push('other'); return canonical.renameLayer(...args); },
    exportPngArtifact: exportArtifact
  };
  registry.register(session.id, ports);
  return { workspace, application, session, service, registry, ports, creation, creationPorts, fonts, order, failures,
    exportArtifact, initial, request, get handle() { return handle; },
    setPixels: (value: typeof pixels) => { pixels = value; },
    duringText: (value: typeof duringText) => { duringText = value; }, afterText: (value: typeof afterText) => { afterText = value; },
    context: (value: typeof context) => { context = value; }, retire: () => { current = false; },
    replaceRenderer: () => { renderer = { configureTextFonts: vi.fn() }; },
    replaceSession: () => {
      mountedSession = new DocumentSession({ id: session.id, source: session.getSnapshot().source });
      mountedSession.setDocument(initial); mountedSession.setReady(); const successor = mountedSession;
      cleanup.push(() => successor.dispose()); return successor;
    },
    export: (extra = {}) => service.execute({ ...request('file.exportPng'), ...extra }) };
};

describe('same-runner captured file → text prerequisite (real text/mutation/history owners)', () => {
  it.each(['cold-point', 'cold-paragraph', 'short-drag', 'queued'] as const)('finishes %s once before export, with exact Actions/history and no duplicate observation', async mode => {
    const f = setup(); f.service.startActionRecording('Creation and export');
    if (mode === 'cold-point' || mode === 'queued') void f.creation.beginPoint({ x: 4, y: 5 });
    else { f.creation.beginParagraph(1, { x: 4, y: 5 }); f.creation.move(1, mode === 'short-drag' ? { x: 5, y: 5 } : { x: 40, y: 35 }); }
    const gate = deferred(); f.setPixels(() => gate.promise);
    const expectedDocumentRevision = f.session.getSnapshot().documentRevision;
    const parent = f.export({ expectedDocumentRevision }); await flush();
    if (mode === 'queued') { f.fonts.resolve(); await flush(); expect(f.handle).not.toBeNull(); }
    expect(f.session.getSnapshot().history.undoDepth).toBe(0);
    gate.resolve(); f.fonts.resolve();
    const result = await parent; expect(result).toMatchObject({ status: 'accepted' }); expect((await f.handle!.result).status).toBe('completed');
    if (result.status !== 'accepted') throw new Error('Expected export task');
    await vi.waitFor(() => expect(f.service.queryTask(f.session.id, result.taskId)?.status).toBe('completed'));
    expect(f.session.getSnapshot().history.undoDepth).toBe(1); expect(f.exportArtifact).toHaveBeenCalledOnce();
    expect(f.creationPorts.beginEditing).not.toHaveBeenCalled();
    expect(f.order.indexOf('text')).toBeLessThan(f.order.indexOf('export'));
    expect(f.service.actionRecordingSnapshot().steps.map(step => step.command)).toEqual(['text.create', 'file.exportPng']);
    const committed = f.session.getSnapshot().document;
    await f.session.history.undo(); expect(f.session.getSnapshot().document).toEqual(f.initial);
    await f.session.history.redo(); expect(f.session.getSnapshot().document).toEqual(committed);
  });
  it('promotes only its captured child past an intervening command; another document remains independent', async () => {
    const f = setup(), gate = deferred(); f.setPixels(() => gate.promise);
    void f.creation.beginPoint({ x: 4, y: 5 }); const parent = f.export(); await flush();
    const other = f.service.execute(f.request('layer.rename', { layerId: f.initial.activeLayerId, name: 'Later' }));
    const opened = f.workspace.open({ source: { id: 'other', name: 'Other', mediaType: 'image/png' } });
    if (!opened.ok) throw new Error('Open failed'); const second = opened.value;
    second.setDocument(createImageDocument('Other', 10, 10, 'other')); second.setReady();
    f.registry.register(second.id, createDocumentSessionCommandPorts(second, f.application));
    expect((await f.service.execute({ ...f.request('layer.rename', { layerId: second.getSnapshot().document!.activeLayerId, name: 'Independent' }),
      documentId: second.id })).status).toBe('completed');
    f.fonts.resolve(); await flush(); expect(f.handle).not.toBeNull(); expect(f.order).not.toContain('other');
    gate.resolve(); await Promise.all([parent, other, f.handle!.result]);
    expect(f.order.filter(value => ['text', 'export', 'other'].includes(value))).toEqual(['text', 'export', 'other']);
    expect(f.session.getSnapshot().history.undoDepth).toBe(2);
  });
  it.each(['revision', 'schema', 'capability'] as const)('rejects parent %s before touching creation or direct terminals', async reason => {
    const f = setup(); void f.creation.beginPoint({ x: 4, y: 5 }); const pixels = vi.fn(async () => {}); f.setPixels(pixels);
    if (reason === 'capability') f.ports.supportsCommand = command => command !== 'file.exportPng';
    const result = await f.export(reason === 'revision' ? { expectedDocumentRevision: 999 } : reason === 'schema' ? { parameters: { unsupported: true } } : {});
    expect(result.status).toBe('rejected'); expect(pixels).not.toHaveBeenCalled(); expect(f.handle).toBeNull();
    expect(f.session.getSnapshot().history.undoDepth).toBe(0); f.creation.cancel(); f.fonts.resolve();
  });
  it.each(['cancel', 'supersede', 'renderer'] as const)('rejects %s of an already queued child without a later ghost commit', async kind => {
    const f = setup(), gate = deferred(); f.setPixels(() => gate.promise);
    void f.creation.beginPoint({ x: 4, y: 5 }); const parent = f.export(); await flush(); f.fonts.resolve(); await flush();
    const child = f.handle!; expect(child).not.toBeNull();
    if (kind === 'cancel') f.creation.cancel();
    else if (kind === 'supersede') f.creation.beginParagraph(2, { x: 20, y: 20 });
    else f.replaceRenderer();
    gate.resolve(); expect((await parent).status).toBe('rejected'); expect((await child.result).status).toBe('rejected');
    expect(f.session.getSnapshot().document).toBe(f.initial); expect(f.session.getSnapshot().history.undoDepth).toBe(0);
    expect(f.exportArtifact).not.toHaveBeenCalled(); expect(f.failures).not.toHaveBeenCalled(); f.creation.cancel();
  });
  it('rejects cancel during the real semantic font/patch awaits before canonical mutation', async () => {
    const f = setup(); f.duringText(() => f.creation.cancel());
    void f.creation.beginPoint({ x: 4, y: 5 }); const parent = f.export(); f.fonts.resolve();
    expect((await parent).status).toBe('rejected'); expect((await f.handle!.result).status).toBe('rejected');
    expect(f.session.getSnapshot().document).toBe(f.initial); expect(f.session.getSnapshot().history.undoDepth).toBe(0);
    expect(f.exportArtifact).not.toHaveBeenCalled();
  });
  it.each(['renderer', 'session'] as const)('rejects actual mounted %s replacement during semantic font awaits', async kind => {
    const f = setup(); f.duringText(() => kind === 'renderer' ? f.replaceRenderer() : void f.replaceSession());
    void f.creation.beginPoint({ x: 4, y: 5 }); const parent = f.export(); f.fonts.resolve();
    expect((await parent).status).toBe('rejected'); expect((await f.handle!.result).status).toBe('rejected');
    expect(f.session.getSnapshot().document).toBe(f.initial); expect(f.session.getSnapshot().history.undoDepth).toBe(0);
  });
  it('allows ordinary same-runtime port re-registration during semantic font awaits', async () => {
    const f = setup(); f.duringText(() => f.registry.register(f.session.id, { ...f.ports }));
    void f.creation.beginPoint({ x: 4, y: 5 }); const parent = f.export(); f.fonts.resolve();
    expect((await parent).status).toBe('accepted'); expect((await f.handle!.result).status).toBe('completed');
    expect(f.session.getSnapshot().history.undoDepth).toBe(1);
  });
  it('allows canonical resolvers to construct fresh adapters for the same session', async () => {
    const f = setup(), registry = new LightTableCommandPortRegistry(() => createDocumentSessionCommandPorts(f.session, f.application));
    const service = new LightTableCommandService(f.workspace, registry); cleanup.push(() => service.dispose());
    expect((await service.execute(f.request('text.create', { mode: 'point', text: 'Canonical', origin: { x: 1, y: 2 },
      style: { font: { assetId: font.assetId } } }))).status).toBe('completed');
    expect(f.session.getSnapshot().history.undoDepth).toBe(1);
  });
  it('counts a promoted child and its suspended parent exactly once for execution barriers', async () => {
    const f = setup(), delivery = deferred(), committed = deferred();
    f.afterText(async () => { committed.resolve(); await delivery.promise; });
    void f.creation.beginPoint({ x: 4, y: 5 }); const parent = f.export(); f.fonts.resolve(); await committed.promise;
    const barrier = f.service.acquireExecutionBarrier('Fixture barrier'); let idle = false;
    const waiter = barrier.waitForIdle().then(() => { idle = true; }); await flush(); expect(idle).toBe(false);
    delivery.resolve(); expect((await parent).status).toBe('accepted'); await waiter; expect(idle).toBe(true);
    barrier.release(); expect((await f.service.execute(f.request('layer.rename',
      { layerId: f.initial.activeLayerId, name: 'After barrier' }))).status).toBe('completed');
  });
  it('retains committed child truth/history when its parent retires before child delivery', async () => {
    const f = setup(), delivery = deferred(), committed = deferred();
    f.afterText(async () => { committed.resolve(); await delivery.promise; });
    f.service.startActionRecording('Retired export'); void f.creation.beginPoint({ x: 4, y: 5 });
    const parent = f.export(); f.fonts.resolve(); await committed.promise;
    expect(f.session.getSnapshot().history.undoDepth).toBe(1); f.retire(); f.creation.cancel(); delivery.resolve();
    expect((await f.handle!.result).status).toBe('completed'); expect((await parent).status).toBe('rejected');
    expect(f.exportArtifact).not.toHaveBeenCalled(); expect(f.creationPorts.beginEditing).not.toHaveBeenCalled();
    expect(f.service.actionRecordingSnapshot().steps.filter(step => step.command === 'text.create')).toHaveLength(1);
  });
  it('preserves the original ignored recording context and lets the queue continue after a child failure', async () => {
    const f = setup(), gate = deferred(); f.setPixels(() => gate.promise);
    f.context({ origin: 'actions-playback', recording: 'ignore' }); f.service.startActionRecording('Ignored child');
    void f.creation.beginPoint({ x: 4, y: 5 }); const parent = f.export(); await flush();
    const other = f.service.execute(f.request('layer.rename', { layerId: f.initial.activeLayerId, name: 'Later' }));
    f.duringText(() => f.creation.cancel()); f.fonts.resolve(); await flush(); gate.resolve();
    expect((await parent).status).toBe('rejected'); expect((await other).status).toBe('completed');
    expect(f.service.actionRecordingSnapshot().steps.some(step => step.command === 'text.create')).toBe(false);
    expect(f.exportArtifact).not.toHaveBeenCalled(); expect(f.session.getSnapshot().history.undoDepth).toBe(1);
  });
});
