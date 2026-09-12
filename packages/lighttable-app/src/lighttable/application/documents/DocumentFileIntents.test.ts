import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from './documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { LIGHTTABLE_COMMAND_PROTOCOL_VERSION } from '../commands/lightTableCommandService';
import { DocumentFileIntents, type DocumentFileIntentPorts } from './DocumentFileIntents';

const deferred = () => { let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
const makeSession = () => {
  const session = new DocumentSession({ id: 'file' as DocumentSessionId,
    source: { id: 'source', name: 'source.png', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Source', 20, 10, 'source')); session.setReady(); return session;
};
const fixture = () => {
  let session = makeSession(); let renderer: object | null = null; let generation = 0;
  const order: string[] = []; const file = new File(['png'], 'result.png');
  const effect = (name: string) => vi.fn(async () => { order.push(name); });
  const revisions = { workspace: 0, document: 0 };
  let task: ReturnType<DocumentFileIntentPorts['commands']['queryTask']> = {
    id: 'task', status: 'completed', progress: 1, error: null, elapsedMs: 2, durationMs: 2,
    artifact: { id: 'artifact', name: 'result.png', mediaType: 'image/png', byteLength: 3 } as never };
  const ports: DocumentFileIntentPorts = {
    getSession: () => session, getRenderer: () => renderer,
    captureScope: () => { const opening = generation; return { isCurrent: () => generation === opening }; },
    settlePixels: effect('pixels'), commitAdjustments: effect('adjustments'), commitLayerDocument: effect('document'),
    finishTextCreation: effect('creation'), finishTextEditing: vi.fn(() => { order.push('editing'); }),
    save: effect('save'), exportJpeg: effect('jpeg'), exportWebp: effect('webp'), exportTiff: effect('tiff'),
    exportPsd: effect('psd'), exportPsdMaximumAppearance: effect('maximum'), exportSvg: effect('svg'),
    commands: {
      execute: vi.fn<DocumentFileIntentPorts['commands']['execute']>(async () => {
        order.push('png'); return { status: 'accepted', requestId: 'request', taskId: 'task', revisions } as never;
      }), queryTask: vi.fn(() => task), resolveArtifact: vi.fn(() => file)
    }, nextRequestId: id => `ui-${id}-1`, captureTextCreation: vi.fn(() => ({ prepare: async () => null, assertCurrent: () => {} })),
    deliverExportFile: effect('deliver'), reportError: vi.fn()
  };
  let currentPorts = ports;
  const owner = new DocumentFileIntents(() => currentPorts);
  return { owner, ports, file, order, session: () => session,
    mount: () => { renderer = {}; }, replacePorts: (value: DocumentFileIntentPorts) => { currentPorts = value; },
    task: (value: typeof task) => { task = value; },
    retire: (kind: 'session' | 'renderer' | 'generation' | 'lifecycle') => {
      if (kind === 'session') session = makeSession();
      else if (kind === 'renderer') renderer = {};
      else if (kind === 'generation') generation++;
      else session.dispose();
    } };
};

describe('UI document file intents', () => {
  it('strict UI preparation returns the exact post-terminal scope without exporting or reporting failures', async () => {
    const f = fixture(); f.mount();
    const result = await f.owner.prepareForUi();
    expect(result.session).toBe(f.session()); expect(result.renderer).toBe(f.ports.getRenderer());
    expect(f.order).toEqual(['pixels', 'adjustments', 'editing', 'document', 'creation']);
    expect(result.isCurrent()).toBe(true);
    f.retire('renderer'); expect(result.isCurrent()).toBe(false);
    expect(() => result.assertCurrent()).toThrow('retired');
    f.ports.commitAdjustments = async () => { throw new Error('Grade rejected'); };
    await expect(f.owner.prepareForUi()).rejects.toThrow('Grade rejected');
    expect(f.ports.reportError).not.toHaveBeenCalled();
  });
  it('strict UI preparation rejects same-ID retirement during a pending terminal', async () => {
    const f = fixture(); f.mount(); const pending = deferred();
    f.ports.settlePixels = () => pending.promise;
    const prepared = expect(f.owner.prepareForUi()).rejects.toThrow('retired');
    f.retire('session'); pending.resolve(); await prepared;
    expect(f.ports.commitAdjustments).not.toHaveBeenCalled();
  });
  it('queued exports finish direct owners without dispatching or awaiting text creation', async () => {
    const f = fixture(); f.mount(); await f.owner.prepareForCommand(f.session(), { consume: vi.fn() });
    expect(f.order).toEqual(['pixels', 'adjustments', 'editing', 'document']);
    expect(f.ports.finishTextCreation).not.toHaveBeenCalled(); expect(f.ports.commands.execute).not.toHaveBeenCalled();
  });
  it('queued exports reject retired creation capture before any settlement and expose the error', async () => {
    const f = fixture(); f.mount(); f.ports.captureTextCreation = () => { throw new Error('Retired creation'); };
    await expect(f.owner.prepareForCommand(f.session(), { consume: vi.fn() })).rejects.toThrow('Retired creation');
    expect(f.order).toEqual([]); expect(f.ports.reportError).not.toHaveBeenCalled();
  });
  it('queued exports reject a new pending creation admitted during pixel settlement', async () => {
    const f = fixture(); f.mount(); f.ports.settlePixels = async () => {
      current = false;
    };
    let current = true;
    f.ports.captureTextCreation = () => ({ prepare: async () => null,
      assertCurrent: () => { if (!current) throw new Error('New pending creation'); } });
    await expect(f.owner.prepareForCommand(f.session(), { consume: vi.fn() })).rejects.toThrow('New pending creation');
    expect(f.ports.finishTextCreation).not.toHaveBeenCalled();
  });
  it('a retained old command binding cannot prepare a replacement session with the same ID', async () => {
    const f = fixture(); f.mount(); const oldSession = f.session(); f.retire('session');
    await expect(f.owner.prepareForCommand(oldSession, { consume: vi.fn() })).rejects.toThrow('session was retired');
    expect(f.order).toEqual([]);
  });
  it.each([
    ['save', 'save'], ['exportJpeg', 'jpeg'], ['exportWebp', 'webp'], ['exportTiff', 'tiff'],
    ['exportPsd', 'psd'], ['exportPsdMaximumAppearance', 'maximum'], ['exportSvg', 'svg']
  ] as const)('prepares before %s and preserves its exact existing format owner', async (method, route) => {
    const f = fixture(); f.mount(); await f.owner[method]();
    expect(f.order).toEqual(['pixels', 'adjustments', 'editing', 'document', 'creation', route]);
    expect(f.ports.commands.execute).not.toHaveBeenCalled();
  });
  it('captures request-time renderer and preserves PNG command metadata, recording defaults and artifact ownership', async () => {
    const f = fixture(); f.mount(); await f.owner.exportPng();
    expect(f.order).toEqual(['pixels', 'adjustments', 'editing', 'document', 'creation', 'png', 'deliver']);
    expect(f.ports.commands.execute).toHaveBeenCalledExactlyOnceWith({
      protocolVersion: LIGHTTABLE_COMMAND_PROTOCOL_VERSION, requestId: 'ui-file-1', documentId: 'file',
      command: 'file.exportPng', parameters: {} });
    expect(f.ports.deliverExportFile).toHaveBeenCalledWith(f.file);
  });
  it('awaits cold creation before entering PNG execute, not recursively inside its command turn', async () => {
    const f = fixture(); f.mount(); const creation = deferred(); f.ports.finishTextCreation = () => creation.promise;
    const pending = f.owner.exportPng(); await flush();
    expect(f.ports.commands.execute).not.toHaveBeenCalled(); creation.resolve(); await pending;
    expect(f.ports.commands.execute).toHaveBeenCalledOnce();
  });
  it.each(['session', 'renderer', 'generation', 'lifecycle'] as const)(
    'rejects exact %s retirement across preparation without writing successor UI', async kind => {
      const f = fixture(); f.mount(); const creation = deferred(); f.ports.finishTextCreation = () => creation.promise;
      const pending = f.owner.save(); await flush(); f.retire(kind); creation.resolve(); await pending;
      expect(f.ports.save).not.toHaveBeenCalled(); expect(f.ports.reportError).not.toHaveBeenCalled();
    });
  it('keeps the request ports across rerender while the next request resolves new ports', async () => {
    const f = fixture(); f.mount(); const pixels = deferred(); f.ports.settlePixels = () => pixels.promise;
    const pending = f.owner.save(); const nextSave = vi.fn(async () => undefined);
    f.replacePorts({ ...f.ports, save: nextSave }); pixels.resolve(); await pending;
    expect(f.ports.save).toHaveBeenCalledOnce(); expect(nextSave).not.toHaveBeenCalled();
    await f.owner.save(); expect(nextSave).toHaveBeenCalledOnce();
  });
  it('reports current preparation failure and never starts a file task', async () => {
    const f = fixture(); f.mount(); f.ports.commitAdjustments = async () => { throw new Error('Admission failed'); };
    await f.owner.exportPng(); expect(f.ports.reportError).toHaveBeenCalledWith('Admission failed');
    expect(f.ports.commands.execute).not.toHaveBeenCalled();
  });
  it('accepts canonical revisions intentionally changed by preparation', async () => {
    const f = fixture(); f.mount(); f.ports.finishTextEditing = () => {
      const document = f.session().getSnapshot().document!;
      f.session().setDocument({ ...document, name: 'Changed' });
    };
    await f.owner.save(); expect(f.ports.save).toHaveBeenCalledOnce();
  });
  it('does not deliver accepted PNG to a replacement renderer while waiting for its artifact', async () => {
    vi.useFakeTimers(); const f = fixture(); f.mount();
    f.task({ id: 'task', status: 'running', progress: null, error: null, elapsedMs: 0, durationMs: null, artifact: null });
    const pending = f.owner.exportPng(); await flush(); f.retire('renderer');
    await vi.advanceTimersByTimeAsync(25); await pending;
    expect(f.ports.deliverExportFile).not.toHaveBeenCalled(); expect(f.ports.reportError).not.toHaveBeenCalled();
  });
  it('treats task cancellation as normal but reports a failed export', async () => {
    const f = fixture(); f.mount(); const task = { id: 'task', progress: null, error: 'Encode failed',
      elapsedMs: 1, durationMs: 1, artifact: null };
    f.task({ ...task, status: 'canceled' }); await f.owner.exportPng(); expect(f.ports.reportError).not.toHaveBeenCalled();
    f.task({ ...task, status: 'failed' }); await f.owner.exportPng(); expect(f.ports.reportError).toHaveBeenCalledWith('Encode failed');
  });
  it('reports rejected PNG and does not invoke another exporter as a fallback', async () => {
    const f = fixture(); f.mount(); f.ports.commands.execute = vi.fn(async () => ({
      status: 'rejected', message: 'Export blocked' } as never));
    await f.owner.exportPng(); expect(f.ports.reportError).toHaveBeenCalledWith('Export blocked');
    expect(f.ports.deliverExportFile).not.toHaveBeenCalled();
  });
});
