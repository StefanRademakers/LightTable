import { beforeEach, expect, it, vi } from 'vitest';
import type { GenAiAssetReference } from '@lighttable/genai-core';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { useGenAiReferenceHandoff, type GenAiReferenceHandoffBinding } from './useGenAiReferenceHandoff';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[],
  setup: null as (() => void | (() => void)) | null, effect: null as (() => void) | null }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => void | (() => void)) => { hooks.setup = setup; },
  useEffect: (effect: () => void) => { hooks.effect = effect; },
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get()
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.setup = null; hooks.effect = null; });
const deferred = <T>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const makeSession = () => {
  const session = new DocumentSession({ id: 'A' as DocumentSessionId,
    source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Image', 20, 10, 'pixels')); session.setReady(); return session;
};
const fixture = () => {
  let session = makeSession(), renderer: object | null = {}, scopeIdentity = {}, available = true;
  let image = session.getSnapshot().document;
  const imported: GenAiAssetReference[] = [];
  const exported = vi.fn(async () => new File(['pixels'], 'A.png', { type: 'image/png' }));
  const binding: GenAiReferenceHandoffBinding = {
    context: { projectId: 'P', documentId: 'A', active: false, workflow: {},
      selectedMode: 'image2image', imageEditReady: true }, workspaceDocuments: [{ id: 'A', kind: 'image' }],
    status: 'ready', commandPorts: { supportsPort: () => available, exportPngArtifact: exported },
    getSession: () => session, getRenderer: () => renderer, getImageDocument: () => image,
    captureScope: () => { const opening = scopeIdentity; return { isCurrent: () => scopeIdentity === opening }; },
    captureImport: isCurrent => ({ isCurrent,
      importFile: async () => {
        if (!isCurrent()) return undefined;
        const asset: GenAiAssetReference = { id: 'asset' as GenAiAssetReference['id'], projectId: 'P',
          label: 'Opening', previewId: 'preview', mediaType: 'image/png' };
        imported.push(asset); return asset;
      }, requestPreview: async () => {}, addReference: () => isCurrent(), removeReference: () => isCurrent() }),
    activateDocument: vi.fn(), reportError: vi.fn()
  };
  const render = () => { hooks.cursor = 0; return useGenAiReferenceHandoff(binding); };
  return { binding, render, exported, imported, session: () => session,
    setRenderer: (value: object | null) => { renderer = value; },
    available: (value: boolean) => { available = value; },
    wrongImage: () => { image = createImageDocument('Other', 20, 10, 'other'); },
    retire: (kind: 'session' | 'renderer' | 'scope' | 'revision' | 'disposed') => {
      if (kind === 'session') { session = makeSession(); image = session.getSnapshot().document; }
      else if (kind === 'renderer') renderer = {};
      else if (kind === 'scope') scopeIdentity = {};
      else if (kind === 'disposed') session.dispose();
      else session.markChanged();
    } };
};

it('captures the ready renderer at request time, not the initial null render', async () => {
  const f = fixture(); f.setRenderer(null); const actions = f.render(); hooks.setup!();
  f.setRenderer({}); await actions.importDocumentReference('A');
  expect(f.exported).toHaveBeenCalledOnce(); expect(f.imported).toHaveLength(1);
});
it.each(['null-renderer', 'mixed-image', 'unregistered', 'opening'] as const)(
  'does not export a %s document binding', async kind => {
    const f = fixture();
    if (kind === 'null-renderer') f.setRenderer(null);
    else if (kind === 'mixed-image') f.wrongImage();
    else if (kind === 'unregistered') f.available(false);
    else Object.assign(f.binding, { status: 'starting' });
    const actions = f.render(); hooks.setup!(); await actions.importDocumentReference('A');
    expect(f.exported).not.toHaveBeenCalled(); expect(f.imported).toEqual([]);
    expect(f.binding.reportError).toHaveBeenCalledWith('The reference document is not ready for export.');
  });
it.each(['session', 'renderer', 'scope', 'revision', 'disposed'] as const)(
  'rejects %s retirement during PNG export, including equal scalar identity replacement', async kind => {
    const f = fixture(), pending = deferred<File>(); f.exported.mockReturnValueOnce(pending.promise);
    const actions = f.render(); hooks.setup!(); const operation = actions.importDocumentReference('A');
    f.retire(kind); pending.resolve(new File(['pixels'], 'A.png')); await operation;
    expect(f.imported).toEqual([]); expect(f.binding.reportError).not.toHaveBeenCalled();
  });
it('does not admit a disposed session before React cleanup', async () => {
  const f = fixture(); const actions = f.render(); hooks.setup!(); f.retire('disposed');
  await actions.importDocumentReference('A'); expect(f.exported).not.toHaveBeenCalled();
});
it('waits until a later readiness effect sees the registered command port', async () => {
  const f = fixture(); f.available(false); const actions = f.render(); hooks.setup!();
  actions.requestTabReference('A'); hooks.effect!(); expect(f.exported).not.toHaveBeenCalled();
  f.available(true); f.render(); hooks.effect!();
  await vi.waitFor(() => expect(f.imported).toHaveLength(1)); expect(f.exported).toHaveBeenCalledOnce();
});
it('StrictMode setup replay cannot revive an old export but allows the next request', async () => {
  const f = fixture(), pending = deferred<File>(); f.exported.mockReturnValueOnce(pending.promise);
  const actions = f.render(), cleanup = hooks.setup!(); const old = actions.importDocumentReference('A');
  if (cleanup) cleanup(); hooks.setup!(); pending.resolve(new File(['pixels'], 'A.png')); await old;
  expect(f.imported).toEqual([]); await actions.importDocumentReference('A'); expect(f.imported).toHaveLength(1);
});
