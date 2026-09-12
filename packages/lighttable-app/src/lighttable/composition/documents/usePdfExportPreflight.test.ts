import { beforeEach, expect, it, vi } from 'vitest';
import { usePdfExportPreflight, type PdfExportPreflightBindingPorts } from './usePdfExportPreflight';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import type { PreparedDocumentFileScope } from '../../application/documents/DocumentFileIntents';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], setup: null as (() => void | (() => void)) | null }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => void | (() => void)) => { hooks.setup = setup; }
}));
vi.mock('../../infrastructure/pdf/writeRasterPdfPage', () => ({ writeRasterPdfPage: async () => ({ blob: new Blob(['pdf']) }) }));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.setup = null; });
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const makeSession = () => {
  const session = new DocumentSession({ id: 'same-id' as DocumentSessionId,
    source: { id: 'same-source', name: 'Image', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Image', 20, 10, 'pixels')); session.setReady(); return session;
};
const makeRenderer = () => ({ exportPng: vi.fn(async () => new Blob(['pixels'])),
  textEditingLayout: vi.fn(() => null), synchronizeDocumentForExport: vi.fn(),
  waitForTextSourcesForExport: vi.fn(async () => true) });
const fixture = () => {
  let session = makeSession(); let generation = 0;
  let renderer: ReturnType<PdfExportPreflightBindingPorts['getRenderer']> = null;
  let fonts = { availableAssets: [], bytes: async () => null };
  const ports: PdfExportPreflightBindingPorts = {
    getSession: () => session, getRenderer: () => renderer, getFonts: () => fonts, getFileName: () => 'Opening',
    captureScope: () => { const opening = generation; return { isCurrent: () => generation === opening }; },
    fileIntents: { prepareForUi: vi.fn(async () => capture()) },
    deliver: vi.fn(async () => {}), openDialog: vi.fn(), reportError: vi.fn()
  };
  const capture = (): PreparedDocumentFileScope => {
    const openingSession = session, openingRenderer = renderer, openingGeneration = generation;
    const isCurrent = () => session === openingSession && renderer === openingRenderer && generation === openingGeneration;
    return { session, renderer: renderer!, isCurrent,
      assertCurrent: () => { if (!isCurrent()) throw new DOMException('Retired', 'AbortError'); } };
  };
  const render = () => { hooks.cursor = 0; return usePdfExportPreflight(ports); };
  return { ports, render, capture, session: () => session,
    mountRenderer: () => { renderer = makeRenderer(); },
    retire: (kind: 'session' | 'renderer' | 'generation' | 'fonts' | 'dispose') => {
      if (kind === 'session') session = makeSession();
      else if (kind === 'renderer') renderer = makeRenderer();
      else if (kind === 'generation') generation++;
      else if (kind === 'fonts') fonts = { availableAssets: [], bytes: async () => null };
      else session.dispose();
    } };
};

it('does not settle owners for a ready session without an admitted renderer', async () => {
  const f = fixture(); const open = f.render(); hooks.setup!();
  await open();
  expect(f.ports.fileIntents.prepareForUi).not.toHaveBeenCalled();
  expect(f.ports.openDialog).not.toHaveBeenCalled();
  expect(f.ports.reportError).not.toHaveBeenCalled();
  expect(f.ports.deliver).not.toHaveBeenCalled();
});
it('does not settle owners when the projected image belongs to the previous session', async () => {
  const f = fixture(); f.mountRenderer();
  const previousDocument = f.session().getSnapshot().document;
  const physicalRenderer = f.ports.getRenderer()!;
  f.retire('session');
  f.ports.getRenderer = () => previousDocument?.id === f.session().getSnapshot().document?.id
    ? physicalRenderer : null;
  const open = f.render(); hooks.setup!(); await open();
  expect(f.ports.fileIntents.prepareForUi).not.toHaveBeenCalled();
  expect(f.ports.openDialog).not.toHaveBeenCalled();
  expect(f.ports.reportError).not.toHaveBeenCalled();
  expect(f.ports.deliver).not.toHaveBeenCalled();
});
it('captures the concrete ready renderer at invocation, not first render, and retains exact export source', async () => {
  const f = fixture(); const open = f.render(); hooks.setup!(); f.mountRenderer();
  await open(); expect(f.ports.openDialog).toHaveBeenCalledOnce();
  const request = vi.mocked(f.ports.openDialog).mock.calls[0][0];
  f.ports.getFileName = () => 'Later'; await request.exportFlattenedPage!();
  expect(vi.mocked(f.ports.deliver).mock.calls[0][0].name).toBe('Opening.pdf');
});
it.each(['session', 'renderer', 'generation', 'fonts', 'dispose'] as const)(
  'does not open a dialog or report old failure after %s retirement during preparation', async kind => {
    const f = fixture(); const open = f.render(); hooks.setup!(); f.mountRenderer();
    const pending = deferred<PreparedDocumentFileScope>(); f.ports.fileIntents.prepareForUi = () => pending.promise;
    const operation = open(); f.retire(kind); pending.reject(new Error('Old preparation failed')); await operation;
    expect(f.ports.openDialog).not.toHaveBeenCalled(); expect(f.ports.reportError).not.toHaveBeenCalled();
  });
it('reports a genuine current prerequisite failure and does not open preflight', async () => {
  const f = fixture(); const open = f.render(); hooks.setup!(); f.mountRenderer();
  f.ports.fileIntents.prepareForUi = async () => { throw new Error('Grade did not commit'); };
  await open(); expect(f.ports.reportError).toHaveBeenCalledWith('Grade did not commit');
  expect(f.ports.openDialog).not.toHaveBeenCalled();
});
it('allows StrictMode setup replay but never revives the prior opening request', async () => {
  const f = fixture(); const open = f.render(); const cleanup = hooks.setup!(); f.mountRenderer();
  const pending = deferred<PreparedDocumentFileScope>();
  const scope = f.capture(); f.ports.fileIntents.prepareForUi = () => pending.promise;
  const oldOpen = open(); if (cleanup) cleanup(); hooks.setup!(); pending.resolve(scope); await oldOpen;
  expect(f.ports.openDialog).not.toHaveBeenCalled();
  await open(); expect(f.ports.openDialog).toHaveBeenCalledOnce();
});
it('does not prepare any owners when an unmounted callback is invoked', async () => {
  const f = fixture(); const open = f.render(); const cleanup = hooks.setup!(); f.mountRenderer();
  if (cleanup) cleanup(); await open(); expect(f.ports.fileIntents.prepareForUi).not.toHaveBeenCalled();
});
it('latest preflight opening wins; old dialog exports cannot settle a successor request', async () => {
  const f = fixture(); const open = f.render(); hooks.setup!(); f.mountRenderer();
  await open(); const old = vi.mocked(f.ports.openDialog).mock.calls[0][0]; await open();
  vi.mocked(f.ports.fileIntents.prepareForUi).mockClear();
  await expect(old.exportFlattenedPage!()).rejects.toMatchObject({ name: 'AbortError' });
  expect(f.ports.fileIntents.prepareForUi).not.toHaveBeenCalled(); expect(f.ports.deliver).not.toHaveBeenCalled();
});
it('synchronizes the post-terminal canonical document and waits for actual text sources before planning', async () => {
  const f = fixture(); const open = f.render(); hooks.setup!(); f.mountRenderer();
  const pending = deferred<boolean>();
  const renderer = f.ports.getRenderer()!; renderer.waitForTextSourcesForExport = () => pending.promise;
  const operation = open(); await Promise.resolve(); await Promise.resolve();
  expect(renderer.synchronizeDocumentForExport).toHaveBeenCalledWith(f.session().getSnapshot().document);
  expect(f.ports.openDialog).not.toHaveBeenCalled(); pending.resolve(true); await operation;
  expect(f.ports.openDialog).toHaveBeenCalledOnce();
});
it.each(['not-ready', 'changed', 'retired'] as const)('rejects %s text preparation without constructing a provisional plan', async kind => {
  const f = fixture(); const open = f.render(); hooks.setup!(); f.mountRenderer();
  f.ports.getRenderer()!.waitForTextSourcesForExport = async () => {
    if (kind === 'changed') f.session().publishProcessing({ globalGradeStrength: 40 });
    if (kind === 'retired') f.retire('generation');
    return kind !== 'not-ready';
  };
  await open(); expect(f.ports.openDialog).not.toHaveBeenCalled();
  if (kind === 'retired') expect(f.ports.reportError).not.toHaveBeenCalled();
  else expect(f.ports.reportError).toHaveBeenCalledOnce();
});
