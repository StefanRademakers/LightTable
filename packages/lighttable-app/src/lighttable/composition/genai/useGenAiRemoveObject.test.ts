import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenAiProviderId } from '@lighttable/genai-core';
import type { LightTableGenAiService } from '../../../platform/LightTableHost';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import { captureRemoveObjectSource } from '../../application/genai/RemoveObjectSourceCapture';
import { useGenAiRemoveObject } from './useGenAiRemoveObject';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], setup: null as null | (() => () => void),
  dependencies: null as null | readonly unknown[], changed: false }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => () => void, dependencies: readonly unknown[]) => {
    hooks.changed = !hooks.dependencies || dependencies.some((value, index) => value !== hooks.dependencies![index]);
    hooks.dependencies = [...dependencies]; hooks.setup = setup;
  }
}));
vi.mock('../../application/genai/RemoveObjectSourceCapture', () => ({ captureRemoveObjectSource: vi.fn() }));
const sessions: DocumentSession[] = [];
const capture = vi.mocked(captureRemoveObjectSource);
beforeEach(() => {
  hooks.cursor = 0; hooks.slots = []; hooks.setup = null; hooks.dependencies = null; hooks.changed = false; capture.mockReset();
  capture.mockImplementation(async ports => {
    ports.assertCurrent(); await ports.fileIntents.prepareForUi(); ports.assertCurrent();
    return { baseBlob: new Blob(['base']), selectionBlob: new Blob(['mask']), documentName: ports.documentName,
      width: 2, height: 2, editorDelivery: { projectId: ports.projectId, documentId: ports.session.id,
        sourceRevision: ports.session.getSnapshot().documentRevision, behavior: 'place-edit' }, assertCurrent: ports.assertCurrent };
  });
});
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve };
};
const makeSession = () => {
  const session = new DocumentSession({ id: 'same-id' as DocumentSessionId,
    source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Image', 2, 2, 'pixels'));
  session.updateEditor(editor => ({ ...editor, selectionRevision: 1,
    selectionMaskSnapshot: SelectionMaskSnapshot.fromRaw(2, 2, new Uint16Array(4).fill(0x3c00)),
    selectionSupportBounds: { x: 0, y: 0, width: 2, height: 2 } }));
  session.setReady(); sessions.push(session); return session;
};
const setup = () => {
  let session = makeSession(), renderer = {} as DocumentRendererPort, scope = {};
  const discovery = deferred(), reached = deferred();
  const service = {
    getProviderSnapshots: vi.fn(async () => { reached.resolve(); await discovery.promise;
      return [{ id: 'other', status: 'connected' }, { id: 'preferred', status: 'connected' }]; }),
    listModels: vi.fn(async () => [{ id: 'model', capabilities: ['inpaint'] }]),
    loadWorkflow: vi.fn(async () => ({ id: 'workflow', fields: [] })),
    importProjectAsset: vi.fn(async (projectId: string) => ({ id: 'asset', projectId })),
    submitGeneration: vi.fn(async () => ({ status: 'submitted' }))
  };
  let binding: Parameters<typeof useGenAiRemoveObject>[0] = {
    service: service as unknown as LightTableGenAiService, projectId: 'original',
    preferredProviderIds: ['preferred' as GenAiProviderId], documentName: 'Original',
    fileIntents: { prepareForUi: vi.fn(async () => ({ session, renderer, isCurrent: () => true, assertCurrent: () => {} })) },
    getSession: () => session, getRenderer: () => renderer, getDocument: () => session.getSnapshot().document,
    captureScope: () => { const opening = scope; return { isCurrent: () => scope === opening }; },
    hasActiveMutation: () => false, projectProcessing: vi.fn(), status: vi.fn(), error: vi.fn()
  };
  const render = () => { hooks.cursor = 0; return useGenAiRemoveObject(binding); };
  return { service, render, reached: reached.promise, resume: discovery.resolve,
    get binding() { return binding; }, session: () => session,
    replace: (patch: Partial<typeof binding>) => { binding = { ...binding, ...patch }; render(); },
    retire: (kind: 'session' | 'renderer' | 'scope' | 'disposed' | 'revision' | 'selection') => {
      if (kind === 'session') session = makeSession();
      else if (kind === 'renderer') renderer = {} as DocumentRendererPort;
      else if (kind === 'scope') scope = {};
      else if (kind === 'disposed') session.dispose();
      else if (kind === 'revision') session.markChanged();
      else session.updateEditor(editor => ({ ...editor, selectionRevision: editor.selectionRevision + 1 }));
    } };
};
describe('useGenAiRemoveObject', () => {
  it('pins opening provider preference, name and file preparation across rerender', async () => {
    const f = setup(), original = f.binding, run = f.render(); hooks.setup!();
    const pending = run(); await f.reached;
    const successorFile = { prepareForUi: vi.fn() };
    f.replace({ preferredProviderIds: ['other' as GenAiProviderId], documentName: 'Later', fileIntents: successorFile });
    f.resume(); await pending;
    expect(f.service.listModels).toHaveBeenCalledExactlyOnceWith('preferred');
    expect(original.fileIntents.prepareForUi).toHaveBeenCalledOnce();
    expect(successorFile.prepareForUi).not.toHaveBeenCalled();
    expect(capture.mock.calls[0]![0]).toMatchObject({ documentName: 'Original', projectId: 'original', session: f.session() });
    expect(f.service.submitGeneration).toHaveBeenCalledOnce();
  });
  it.each(['session', 'renderer', 'scope', 'disposed', 'project', 'service'] as const)('stops %s retirement during discovery quietly', async kind => {
    const f = setup(), run = f.render(); hooks.setup!(); const pending = run(); await f.reached;
    if (kind === 'project') f.replace({ projectId: 'successor' });
    else if (kind === 'service') f.replace({ service: {} as LightTableGenAiService });
    else f.retire(kind);
    vi.mocked(f.binding.error).mockClear(); vi.mocked(f.binding.status).mockClear();
    f.resume(); await pending;
    expect(capture).not.toHaveBeenCalled(); expect(f.service.listModels).not.toHaveBeenCalled();
    expect(f.binding.error).not.toHaveBeenCalled(); expect(f.binding.status).not.toHaveBeenCalled();
  });
  it.each(['revision', 'selection'] as const)('rejects changed %s before original file preparation', async kind => {
    const f = setup(), run = f.render(); hooks.setup!(); const pending = run(); await f.reached;
    f.retire(kind); f.resume(); await pending;
    expect(capture).not.toHaveBeenCalled(); expect(f.binding.fileIntents.prepareForUi).not.toHaveBeenCalled();
    expect(f.binding.error).toHaveBeenLastCalledWith(expect.stringContaining('changed during provider discovery'));
    expect(f.service.submitGeneration).not.toHaveBeenCalled();
  });
  it('rejects retained callbacks after unmount and does not revive pending work on replay', async () => {
    const f = setup(), run = f.render(), disconnect = hooks.setup!();
    const pending = run(); await f.reached; disconnect(); await run(); hooks.setup!(); f.resume(); await pending;
    expect(capture).not.toHaveBeenCalled(); expect(f.service.getProviderSnapshots).toHaveBeenCalledOnce();
    await run(); expect(f.service.submitGeneration).toHaveBeenCalledOnce();
  });
  it('uses latest current error/status callbacks without changing the captured source', async () => {
    const f = setup(), opening = f.binding, run = f.render(); hooks.setup!(); const pending = run(); await f.reached;
    const error = vi.fn(), status = vi.fn(); f.replace({ error, status });
    f.service.listModels.mockRejectedValueOnce(new Error('Current provider failure')); f.resume(); await pending;
    expect(error).toHaveBeenCalledExactlyOnceWith('Current provider failure');
    expect(status).toHaveBeenCalledExactlyOnceWith(null);
    expect(opening.error).toHaveBeenCalledExactlyOnceWith(null);
  });
  it.each(['project', 'service'] as const)('does not revive an old request after committed %s A→B→A', async kind => {
    const f = setup(), original = f.binding, run = f.render(); let disconnect = hooks.setup!();
    const pending = run(); await f.reached;
    f.replace(kind === 'project' ? { projectId: 'B' } : { service: {} as LightTableGenAiService });
    expect(hooks.changed).toBe(true); disconnect(); disconnect = hooks.setup!();
    f.replace(kind === 'project' ? { projectId: original.projectId } : { service: original.service });
    expect(hooks.changed).toBe(true); disconnect(); disconnect = hooks.setup!();
    vi.mocked(original.error).mockClear(); vi.mocked(original.status).mockClear();
    f.resume(); await pending;
    expect(capture).not.toHaveBeenCalled(); expect(f.service.submitGeneration).not.toHaveBeenCalled();
    expect(original.error).not.toHaveBeenCalled(); expect(original.status).not.toHaveBeenCalled();
    await run(); expect(f.service.submitGeneration).toHaveBeenCalledOnce(); disconnect();
  });
});
